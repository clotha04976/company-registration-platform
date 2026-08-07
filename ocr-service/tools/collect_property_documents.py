from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


CATEGORIES = (
    ("tax_registration", re.compile(r"(?:房屋)?稅籍證明")),
    ("building_transcript", re.compile(r"建物.*謄本")),
    ("building_title", re.compile(r"建物.*(?:所[有以]權狀|權狀)|所有權狀")),
    ("house_tax", re.compile(r"房屋稅")),
    ("precheck", re.compile(r"(?:名稱.*預查|預查.*(?:核定|名稱|表))")),
)
ALLOWED_SUFFIXES = {".pdf", ".jpg", ".jpeg", ".png", ".tif", ".tiff"}


def classify(name: str) -> str | None:
    for category, pattern in CATEGORIES:
        if pattern.search(name):
            return category
    return None


def iter_files(folder: Path):
    try:
        children = list(folder.iterdir())
    except OSError:
        return
    for child in children:
        try:
            if child.is_symlink():
                continue
            if child.is_dir():
                yield from iter_files(child)
            elif child.suffix.lower() in ALLOWED_SUFFIXES:
                yield child
        except OSError:
            continue


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a private, path-only manifest of property-document samples."
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--max-per-category", type=int, default=50)
    parser.add_argument(
        "--folder-prefix",
        action="append",
        default=[],
        help="Only scan top-level customer folders with this prefix; repeatable.",
    )
    args = parser.parse_args()
    counts: Counter[str] = Counter()
    records = []
    top_folders = sorted(
        (path for path in args.source.iterdir() if path.is_dir()),
        key=lambda path: path.name,
        reverse=True,
    )
    if args.folder_prefix:
        top_folders = [
            path
            for path in top_folders
            if any(path.name.startswith(prefix) for prefix in args.folder_prefix)
        ]
    for customer_folder in top_folders:
        if all(counts[name] >= args.max_per_category for name, _ in CATEGORIES):
            break
        for path in iter_files(customer_folder):
            category = classify(path.name)
            if not category or counts[category] >= args.max_per_category:
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            records.append(
                {
                    "category": category,
                    "source_path": str(path),
                    "suffix": path.suffix.lower(),
                    "size_bytes": stat.st_size,
                    "modified_utc": datetime.fromtimestamp(
                        stat.st_mtime, timezone.utc
                    ).isoformat(),
                    "annotation_status": "pending",
                }
            )
            counts[category] += 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as stream:
        for record in records:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(json.dumps({"total": len(records), "counts": counts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
