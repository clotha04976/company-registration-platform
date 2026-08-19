from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cv2
import numpy as np
import pypdfium2 as pdfium

from app.engine import IdentityOcrEngine
from app.identity import OcrToken
from tools.bootstrap_property_labels import (
    FIELD_LABELS,
    find_label,
    normalize,
    valid_value,
    value_tokens,
)


ROI_POLICIES = {
    "safe": {
        "tax_registration": (0.02, 0.00, 0.98, 0.50),
        "house_tax": (0.02, 0.00, 0.98, 0.48),
        "building_transcript": (0.02, 0.00, 0.98, 0.68),
        "building_title": (0.02, 0.00, 0.98, 0.72),
    },
    "aggressive": {
        "tax_registration": (0.04, 0.00, 0.96, 0.36),
        "house_tax": (0.04, 0.00, 0.96, 0.36),
        "building_transcript": (0.04, 0.00, 0.96, 0.52),
        "building_title": (0.04, 0.00, 0.96, 0.56),
    },
}


def crop(image: np.ndarray, roi: tuple[float, float, float, float]) -> np.ndarray:
    height, width = image.shape[:2]
    left, top, right, bottom = roi
    return image[
        round(top * height) : round(bottom * height),
        round(left * width) : round(right * width),
    ]


def extract_fields(
    engine: IdentityOcrEngine,
    ocr,
    image: np.ndarray,
    *,
    classify_orientation: bool = True,
):
    started = time.perf_counter()
    tokens = engine._tokens(
        ocr.predict(
            input=image,
            use_doc_orientation_classify=classify_orientation,
        )
    )
    fields = {}
    for field in FIELD_LABELS:
        match = find_label(tokens, field)
        if not match:
            continue
        label, _ = match
        values = value_tokens(tokens, label)
        text = "".join(token.text for token in values)
        if values and valid_value(field, text):
            fields[field] = normalize(text)
    return {
        "fields": fields,
        "tokens": len(tokens),
        "duration_ms": round((time.perf_counter() - started) * 1000),
    }


def fields_from_tokens(tokens: list[OcrToken]) -> dict[str, str]:
    fields = {}
    for field in FIELD_LABELS:
        match = find_label(tokens, field)
        if not match:
            continue
        label, _ = match
        values = value_tokens(tokens, label)
        text = "".join(token.text for token in values)
        if values and valid_value(field, text):
            fields[field] = normalize(text)
    return fields


def extract_filtered_boxes(
    ocr,
    image: np.ndarray,
    bottom_ratio: float,
) -> dict:
    """Detect the full page, but recognize only boxes in the useful upper region."""
    started = time.perf_counter()
    pipeline = ocr.paddlex_pipeline._pipeline
    preprocessed = list(
        pipeline.doc_preprocessor_pipeline(
            [image],
            use_doc_orientation_classify=True,
            use_doc_unwarping=False,
        )
    )[0]["output_img"]
    detected = list(
        pipeline.text_det_model(
            [preprocessed],
            **pipeline.get_text_det_params(),
        )
    )[0]
    all_polys = list(pipeline._sort_boxes(detected["dt_polys"]))
    cutoff = preprocessed.shape[0] * bottom_ratio
    selected_polys = [
        poly for poly in all_polys if float(np.mean(np.asarray(poly)[:, 1])) <= cutoff
    ]

    subs = list(pipeline._crop_by_polys(preprocessed, selected_polys))
    valid = [
        (sub, poly)
        for sub, poly in zip(subs, selected_polys)
        if sub.size > 0 and sub.shape[0] > 0 and sub.shape[1] > 0
    ]
    subs = [item[0] for item in valid]
    selected_polys = [item[1] for item in valid]
    if subs:
        angles = [
            int(np.asarray(item["class_ids"], dtype=np.int64).ravel()[0])
            for item in pipeline.textline_orientation_model(subs)
        ]
        subs = pipeline.rotate_image(subs, angles)

    indexed = sorted(
        enumerate(subs),
        key=lambda item: item[1].shape[1] / float(item[1].shape[0]),
    )
    rec_by_index = {}
    for (original, _), rec_result in zip(
        indexed,
        pipeline.text_rec_model([item[1] for item in indexed]),
    ):
        rec_by_index[original] = rec_result

    tokens = []
    for index, poly in enumerate(selected_polys):
        rec_result = rec_by_index.get(index)
        if not rec_result or rec_result["rec_score"] < pipeline.text_rec_score_thresh:
            continue
        points = np.asarray(poly, dtype=float)
        box = (
            float(points[:, 0].min()),
            float(points[:, 1].min()),
            float(points[:, 0].max()),
            float(points[:, 1].max()),
        )
        tokens.append(
            OcrToken(
                str(rec_result["rec_text"]),
                float(rec_result["rec_score"]),
                box,
            )
        )
    tokens = sorted(
        tokens,
        key=lambda token: (
            round(token.center_y / max(token.height, 1)),
            token.center_x,
        ),
    )
    return {
        "fields": fields_from_tokens(tokens),
        "tokens": len(tokens),
        "all_boxes": len(all_polys),
        "selected_boxes": len(selected_polys),
        "duration_ms": round((time.perf_counter() - started) * 1000),
    }


def comparable(left: str, right: str) -> bool:
    left_value = re.sub(r"[^A-Za-z0-9\u4e00-\u9fff]", "", left)
    right_value = re.sub(r"[^A-Za-z0-9\u4e00-\u9fff]", "", right)
    return bool(left_value and right_value) and (
        left_value == right_value
        or left_value in right_value
        or right_value in left_value
    )


def pdf_pages(path: Path):
    document = pdfium.PdfDocument(io.BytesIO(path.read_bytes()))
    for page_number, page in enumerate(document, 1):
        text = page.get_textpage().get_text_range() or ""
        rgb = np.asarray(page.render(scale=2.2).to_pil().convert("RGB"))
        yield page_number, text, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def image_pages(path: Path):
    image = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)
    if image is not None:
        yield 1, "", image


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare full-page PP-OCRv6 with fixed property-document ROIs."
    )
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    records = [
        json.loads(line)
        for line in args.manifest.read_text(encoding="utf-8").splitlines()
        if line.strip() and json.loads(line).get("category") != "precheck"
    ]
    engine = IdentityOcrEngine()
    ocr = engine._load()
    totals = Counter()
    policy_totals = {name: Counter() for name in ROI_POLICIES}
    modular_totals = Counter()
    by_category = {
        name: defaultdict(Counter) for name in ROI_POLICIES
    }
    for record in records:
        path = Path(record["source_path"])
        category = record["category"]
        iterator = pdf_pages(path) if path.suffix.lower() == ".pdf" else image_pages(path)
        try:
            for _, text_layer, image in iterator:
                totals["pages"] += 1
                if len(re.sub(r"\s+", "", text_layer)) >= 120:
                    totals["text_layer_pages"] += 1
                    continue
                totals["ocr_pages"] += 1
                full = extract_fields(engine, ocr, image)
                totals["full_tokens"] += full["tokens"]
                totals["full_duration_ms"] += full["duration_ms"]
                for field in full["fields"]:
                    totals[f"full_{field}"] += 1
                modular = extract_filtered_boxes(
                    ocr,
                    image,
                    ROI_POLICIES["safe"][category][3],
                )
                modular_totals["pages"] += 1
                modular_totals["tokens"] += modular["tokens"]
                modular_totals["all_boxes"] += modular["all_boxes"]
                modular_totals["selected_boxes"] += modular["selected_boxes"]
                modular_totals["duration_ms"] += modular["duration_ms"]
                for field, full_value in full["fields"].items():
                    modular_totals["baseline_fields"] += 1
                    modular_value = modular["fields"].get(field, "")
                    if comparable(full_value, modular_value):
                        modular_totals["matched_fields"] += 1
                for policy_name, category_rois in ROI_POLICIES.items():
                    roi = category_rois[category]
                    result = extract_fields(
                        engine,
                        ocr,
                        crop(image, roi),
                        classify_orientation=False,
                    )
                    current = policy_totals[policy_name]
                    current["pages"] += 1
                    current["tokens"] += result["tokens"]
                    current["duration_ms"] += result["duration_ms"]
                    current["area_basis_points"] += round(
                        (roi[2] - roi[0]) * (roi[3] - roi[1]) * 10000
                    )
                    category_counter = by_category[policy_name][category]
                    for field, full_value in full["fields"].items():
                        current["baseline_fields"] += 1
                        category_counter["baseline_fields"] += 1
                        roi_value = result["fields"].get(field, "")
                        if comparable(full_value, roi_value):
                            current["matched_fields"] += 1
                            category_counter["matched_fields"] += 1
        except Exception:
            totals["failed_files"] += 1
    report = {
        "dataset": dict(totals),
        "policies": {},
        "filtered_boxes": {
            "field_agreement": round(
                modular_totals["matched_fields"]
                / max(modular_totals["baseline_fields"], 1),
                4,
            ),
            "box_ratio": round(
                modular_totals["selected_boxes"]
                / max(modular_totals["all_boxes"], 1),
                4,
            ),
            "token_ratio": round(
                modular_totals["tokens"] / max(totals["full_tokens"], 1), 4
            ),
            "duration_ratio": round(
                modular_totals["duration_ms"]
                / max(totals["full_duration_ms"], 1),
                4,
            ),
            "matched_fields": modular_totals["matched_fields"],
            "baseline_fields": modular_totals["baseline_fields"],
        },
    }
    for policy_name, current in policy_totals.items():
        pages = max(current["pages"], 1)
        baseline_fields = max(current["baseline_fields"], 1)
        report["policies"][policy_name] = {
            "field_agreement": round(current["matched_fields"] / baseline_fields, 4),
            "mean_area_ratio": round(current["area_basis_points"] / pages / 10000, 4),
            "token_ratio": round(current["tokens"] / max(totals["full_tokens"], 1), 4),
            "duration_ratio": round(
                current["duration_ms"] / max(totals["full_duration_ms"], 1), 4
            ),
            "by_category": {
                category: {
                    "matched": values["matched_fields"],
                    "baseline": values["baseline_fields"],
                }
                for category, values in by_category[policy_name].items()
            },
        }
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
