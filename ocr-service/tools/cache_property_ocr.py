from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cv2
import numpy as np
import pypdfium2 as pdfium

from app.engine import IdentityOcrEngine


SCHEMA_VERSION = 1
SKIPPED_CATEGORIES = {"precheck"}


def normalized_box(points, width: int, height: int) -> list[int]:
    array = np.asarray(points, dtype=float)
    return [
        round(float(array[:, 0].min()) / width * 1000),
        round(float(array[:, 1].min()) / height * 1000),
        round(float(array[:, 0].max()) / width * 1000),
        round(float(array[:, 1].max()) / height * 1000),
    ]


def page_id(path: Path, page_number: int) -> str:
    stat = path.stat()
    identity = f"{path}|{stat.st_size}|{stat.st_mtime_ns}|{page_number}"
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]


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


def cache_page(
    ocr,
    path: Path,
    category: str,
    page_number: int,
    image: np.ndarray,
    image_dir: Path | None,
):
    started = time.perf_counter()
    result = ocr.predict(input=image)[0]
    duration_ms = round((time.perf_counter() - started) * 1000)
    processed = result["doc_preprocessor_res"]["output_img"]
    height, width = processed.shape[:2]
    texts = result["rec_texts"]
    scores = result["rec_scores"]
    boxes = result["rec_boxes"]
    identifier = page_id(path, page_number)
    image_file = ""
    if image_dir is not None:
        image_dir.mkdir(parents=True, exist_ok=True)
        image_file = f"{identifier}.jpg"
        encoded = cv2.imencode(".jpg", processed, [cv2.IMWRITE_JPEG_QUALITY, 92])[1]
        encoded.tofile(image_dir / image_file)
    return {
        "schema_version": SCHEMA_VERSION,
        "page_id": identifier,
        "source_path": str(path),
        "category": category,
        "page": page_number,
        "width": width,
        "height": height,
        "model": "PP-OCRv6-small",
        "duration_ms": duration_ms,
        "orientation_angle": int(result["doc_preprocessor_res"].get("angle", 0)),
        "image_file": image_file,
        "det_boxes_1000": [
            normalized_box(poly, width, height) for poly in result["dt_polys"]
        ],
        "tokens": [
            {
                "text": str(text),
                "score": round(float(scores[index]), 6),
                "box_1000": [
                    round(float(value) / (width if offset % 2 == 0 else height) * 1000)
                    for offset, value in enumerate(boxes[index])
                ],
            }
            for index, text in enumerate(texts)
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run PP-OCRv6 once and cache private property-document OCR as JSONL."
    )
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--image-dir",
        type=Path,
        help="Optionally save orientation-corrected page images using anonymous IDs.",
    )
    parser.add_argument(
        "--include-text-layer",
        action="store_true",
        help="OCR PDF pages even when they already contain a usable text layer.",
    )
    parser.add_argument(
        "--max-pages-per-document",
        type=int,
        default=0,
        help="Limit rendered pages from each document; 0 means all pages.",
    )
    args = parser.parse_args()
    records = [
        json.loads(line)
        for line in args.manifest.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    engine = IdentityOcrEngine()
    ocr = engine._load()
    summary: Counter[str] = Counter()
    output_records = []
    for record in records:
        category = record["category"]
        if category in SKIPPED_CATEGORIES:
            summary["skipped_categories"] += 1
            continue
        path = Path(record["source_path"])
        iterator = pdf_pages(path) if path.suffix.lower() == ".pdf" else image_pages(path)
        try:
            for page_number, text_layer, image in iterator:
                if (
                    args.max_pages_per_document
                    and page_number > args.max_pages_per_document
                ):
                    break
                if (
                    not args.include_text_layer
                    and len(re.sub(r"\s+", "", text_layer)) >= 120
                ):
                    summary["text_layer_pages"] += 1
                    continue
                output_records.append(
                    cache_page(
                        ocr,
                        path,
                        category,
                        page_number,
                        image,
                        args.image_dir,
                    )
                )
                summary["ocr_pages"] += 1
        except Exception:
            summary["failed_files"] += 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        for record in output_records:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
    temporary.replace(args.output)
    print(json.dumps({"total": len(output_records), "summary": summary}))


if __name__ == "__main__":
    main()
