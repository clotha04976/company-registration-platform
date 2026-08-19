from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.identity import OcrToken
from tools.bootstrap_property_labels import (
    FIELD_LABELS,
    find_label,
    union_box,
    valid_value,
    value_tokens,
)


def token_from(item: dict) -> OcrToken:
    return OcrToken(item["text"], float(item["score"]), tuple(item["box_1000"]))


def pixel_box(box: tuple[float, float, float, float], width: int, height: int):
    return [
        [round(box[0] / 1000 * width), round(box[1] / 1000 * height)],
        [round(box[2] / 1000 * width), round(box[3] / 1000 * height)],
    ]


def shapes_from(record: dict) -> list[dict]:
    tokens = [token_from(item) for item in record["tokens"]]
    shapes = []
    for field in FIELD_LABELS:
        match = find_label(tokens, field)
        if not match:
            continue
        label, _ = match
        values = value_tokens(tokens, label)
        value = "".join(token.text for token in values)
        if not values or not valid_value(field, value):
            continue
        shapes.append(
            {
                "label": field,
                "points": pixel_box(
                    union_box(values),
                    int(record["width"]),
                    int(record["height"]),
                ),
                "group_id": None,
                "description": "PP-OCRv6 pseudo-label; verify before training",
                "shape_type": "rectangle",
                "flags": {"needs_review": True},
            }
        )
    return shapes


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Export an OCR cache as a reviewable LabelMe detection dataset."
    )
    parser.add_argument("cache", type=Path)
    parser.add_argument("image_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    records = [
        json.loads(line)
        for line in args.cache.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    summary: Counter[str] = Counter()
    for record in records:
        image_file = record.get("image_file")
        if not image_file:
            summary["missing_image_reference"] += 1
            continue
        source_image = args.image_dir / image_file
        if not source_image.exists():
            summary["missing_image_file"] += 1
            continue
        destination_image = args.output_dir / image_file
        if source_image.resolve() != destination_image.resolve():
            shutil.copy2(source_image, destination_image)
        shapes = shapes_from(record)
        labelme = {
            "version": "5.6.0",
            "flags": {},
            "shapes": shapes,
            "imagePath": image_file,
            "imageData": None,
            "imageHeight": int(record["height"]),
            "imageWidth": int(record["width"]),
        }
        (args.output_dir / f"{record['page_id']}.json").write_text(
            json.dumps(labelme, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        summary["pages"] += 1
        summary["empty_pages"] += int(not shapes)
        for shape in shapes:
            summary[shape["label"]] += 1
    (args.output_dir / "labels.txt").write_text(
        "property_address\ntax_registration_number\n",
        encoding="utf-8",
    )
    print(json.dumps({"summary": summary}, ensure_ascii=False))


if __name__ == "__main__":
    main()
