from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.identity import OcrToken
from tools.bootstrap_property_labels import (
    FIELD_LABELS,
    find_label,
    normalize,
    valid_value,
    value_tokens,
)


DEFAULT_BOTTOM_RATIOS = {
    "tax_registration": 0.50,
    "house_tax": 0.48,
    "building_transcript": 0.68,
    "building_title": 0.72,
}


def tokens_from(record: dict) -> list[OcrToken]:
    return [
        OcrToken(item["text"], float(item["score"]), tuple(item["box_1000"]))
        for item in record["tokens"]
    ]


def extract_fields(tokens: list[OcrToken]) -> dict[str, str]:
    fields = {}
    for field in FIELD_LABELS:
        match = find_label(tokens, field)
        if not match:
            continue
        label, _ = match
        values = value_tokens(tokens, label)
        value = "".join(token.text for token in values)
        if values and valid_value(field, value):
            fields[field] = normalize(value)
    return fields


def comparable(left: str, right: str) -> bool:
    left = re.sub(r"[^A-Za-z0-9\u4e00-\u9fff]", "", left)
    right = re.sub(r"[^A-Za-z0-9\u4e00-\u9fff]", "", right)
    return bool(left and right) and (left == right or left in right or right in left)


def evaluate(records: list[dict], ratios: dict[str, float]) -> dict:
    totals = Counter()
    categories = defaultdict(Counter)
    for record in records:
        category = record["category"]
        ratio = ratios[category]
        tokens = tokens_from(record)
        baseline = extract_fields(tokens)
        filtered_tokens = [token for token in tokens if token.center_y <= ratio * 1000]
        filtered = extract_fields(filtered_tokens)
        det_boxes = record["det_boxes_1000"]
        selected_boxes = [box for box in det_boxes if (box[1] + box[3]) / 2 <= ratio * 1000]
        totals["pages"] += 1
        totals["all_boxes"] += len(det_boxes)
        totals["selected_boxes"] += len(selected_boxes)
        for field, value in baseline.items():
            totals["baseline_fields"] += 1
            categories[category]["baseline_fields"] += 1
            if comparable(value, filtered.get(field, "")):
                totals["matched_fields"] += 1
                categories[category]["matched_fields"] += 1
    return {
        "pages": totals["pages"],
        "field_agreement": round(
            totals["matched_fields"] / max(totals["baseline_fields"], 1), 4
        ),
        "matched_fields": totals["matched_fields"],
        "baseline_fields": totals["baseline_fields"],
        "box_ratio": round(
            totals["selected_boxes"] / max(totals["all_boxes"], 1), 4
        ),
        "by_category": {
            category: {
                "matched": values["matched_fields"],
                "baseline": values["baseline_fields"],
            }
            for category, values in categories.items()
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate property OCR region rules without running OCR models."
    )
    parser.add_argument("cache", type=Path)
    args = parser.parse_args()
    started = time.perf_counter()
    records = [
        json.loads(line)
        for line in args.cache.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    report = evaluate(records, DEFAULT_BOTTOM_RATIOS)
    report["evaluation_ms"] = round((time.perf_counter() - started) * 1000, 2)
    report["bottom_ratios"] = DEFAULT_BOTTOM_RATIOS
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
