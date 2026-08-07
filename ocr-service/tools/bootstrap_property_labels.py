from __future__ import annotations

import argparse
import difflib
import io
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cv2
import numpy as np
import pypdfium2 as pdfium

from app.engine import IdentityOcrEngine
from app.identity import OcrToken


FIELD_LABELS = {
    "property_address": (
        "課稅房屋坐落",
        "房屋坐落",
        "建物門牌",
        "坐落地址",
    ),
    "tax_registration_number": (
        "房屋稅籍編號",
        "稅籍編號",
        "稅籍號碼",
    ),
}
SKIPPED_CATEGORIES = {"precheck"}


def normalize(value: str) -> str:
    return re.sub(r"[\s:：|]", "", value)


def label_score(text: str, expected: str) -> float:
    text_value = normalize(text)
    expected_value = normalize(expected)
    if expected_value in text_value:
        return 1.0
    return difflib.SequenceMatcher(None, text_value, expected_value).ratio()


def find_label(tokens: list[OcrToken], field: str) -> tuple[OcrToken, float] | None:
    choices = []
    for token in tokens:
        score = max(label_score(token.text, label) for label in FIELD_LABELS[field])
        if score >= 0.68:
            choices.append((score, token.score, token))
    if not choices:
        return None
    score, _, token = max(choices, key=lambda item: (item[0], item[1]))
    return token, score


def same_row(label: OcrToken, token: OcrToken) -> bool:
    tolerance = max(label.height, token.height) * 0.9
    return abs(label.center_y - token.center_y) <= tolerance


def value_tokens(tokens: list[OcrToken], label: OcrToken) -> list[OcrToken]:
    right = [
        token
        for token in tokens
        if token is not label
        and same_row(label, token)
        and token.box[0] >= label.box[2] - max(6, label.height * 0.3)
    ]
    if right:
        row = sorted(right, key=lambda token: token.box[0])
    else:
        below = [
            token
            for token in tokens
            if token is not label
            and label.box[3] < token.center_y <= label.box[3] + label.height * 4
            and token.box[0] >= label.box[0] - label.height * 2
        ]
        if not below:
            return []
        first_y = min(token.center_y for token in below)
        row = sorted(
            (
                token
                for token in below
                if abs(token.center_y - first_y) <= max(token.height, label.height)
            ),
            key=lambda token: token.box[0],
        )
    selected = []
    for token in row:
        if selected:
            gap = token.box[0] - selected[-1].box[2]
            if gap > max(180, label.height * 10):
                break
        selected.append(token)
    return selected


def union_box(tokens: list[OcrToken]) -> tuple[float, float, float, float]:
    return (
        min(token.box[0] for token in tokens),
        min(token.box[1] for token in tokens),
        max(token.box[2] for token in tokens),
        max(token.box[3] for token in tokens),
    )


def normalized_box(
    box: tuple[float, float, float, float], width: int, height: int
) -> list[int]:
    return [
        round(box[0] / width * 1000),
        round(box[1] / height * 1000),
        round(box[2] / width * 1000),
        round(box[3] / height * 1000),
    ]


def valid_value(field: str, text: str) -> bool:
    compact = normalize(text)
    if field == "tax_registration_number":
        return bool(re.search(r"\d{7,}", compact))
    return len(compact) >= 6 and bool(
        re.search(r"(?:縣|市|區|鄉|鎮|路|街|巷|弄|號)", compact)
    )


def decode_pages(path: Path):
    if path.suffix.lower() == ".pdf":
        document = pdfium.PdfDocument(io.BytesIO(path.read_bytes()))
        for page_number, page in enumerate(document, 1):
            rgb = np.asarray(page.render(scale=2.2).to_pil().convert("RGB"))
            yield page_number, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        return
    image = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)
    if image is not None:
        yield 1, image


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create private PP-OCRv6 pseudo-labels for two property fields."
    )
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    records = [
        json.loads(line)
        for line in args.manifest.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    engine = IdentityOcrEngine()
    ocr = engine._load()
    annotations = []
    summary: Counter[str] = Counter()
    for record in records:
        if record["category"] in SKIPPED_CATEGORIES:
            continue
        path = Path(record["source_path"])
        try:
            pages = decode_pages(path)
            for page_number, image in pages:
                height, width = image.shape[:2]
                tokens = engine._tokens(ocr.predict(input=image))
                page_found = False
                for field in FIELD_LABELS:
                    match = find_label(tokens, field)
                    if not match:
                        continue
                    label, match_score = match
                    values = value_tokens(tokens, label)
                    value_text = "".join(token.text for token in values)
                    if not values or not valid_value(field, value_text):
                        continue
                    annotations.append(
                        {
                            "source_path": str(path),
                            "category": record["category"],
                            "page": page_number,
                            "field": field,
                            "label_box_1000": normalized_box(
                                label.box, width, height
                            ),
                            "value_box_1000": normalized_box(
                                union_box(values), width, height
                            ),
                            "value_text": value_text,
                            "ocr_confidence": round(
                                sum(token.score for token in values) / len(values), 4
                            ),
                            "label_match_score": round(match_score, 4),
                            "annotation_status": "pending_review",
                        }
                    )
                    summary[field] += 1
                    page_found = True
                summary["pages_with_candidates" if page_found else "pages_without_candidates"] += 1
        except Exception:
            summary["files_failed"] += 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as stream:
        for annotation in annotations:
            stream.write(json.dumps(annotation, ensure_ascii=False) + "\n")
    print(json.dumps({"total": len(annotations), "summary": summary}, ensure_ascii=False))


if __name__ == "__main__":
    main()
