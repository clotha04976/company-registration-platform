from __future__ import annotations

import argparse
import json
import re
import sys
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
        "--folder-offset",
        type=int,
        default=0,
        help="Skip this many sorted top-level customer folders.",
    )
    parser.add_argument(
        "--max-folders",
        type=int,
        default=0,
        help="Scan at most this many top-level customer folders; 0 means all.",
    )
    parser.add_argument(
        "--append",
        action="store_true",
        help="Resume into an existing manifest, skipping paths already collected.",
    )
    parser.add_argument(
        "--folder-prefix",
        action="append",
        default=[],
        help="Only scan top-level customer folders with this prefix; repeatable.",
    )
    args = parser.parse_args()
    counts: Counter[str] = Counter()
    existing_paths = set()
    existing_records = []
    if args.append and args.output.exists():
        existing_records = [
            json.loads(line)
            for line in args.output.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        for record in existing_records:
            counts[record["category"]] += 1
            existing_paths.add(record["source_path"])
    records = list(existing_records)
    top_folders = sorted(
        (path for path in args.source.iterdir() if path.is_dir()),
        key=lambda path: path.name,
        reverse=False,
    )
    if args.folder_prefix:
        top_folders = [
            path
            for path in top_folders
            if any(path.name.startswith(prefix) for prefix in args.folder_prefix)
        ]
    top_folders = top_folders[args.folder_offset :]
    if args.max_folders:
        top_folders = top_folders[: args.max_folders]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    mode = "a" if args.append and args.output.exists() else "w"
    scanned_folders = 0
    with args.output.open(mode, encoding="utf-8") as stream:
        for customer_folder in top_folders:
            scanned_folders += 1
            if scanned_folders % 25 == 0:
                print(
                    json.dumps(
                        {"scanned_folders": scanned_folders, "counts": counts},
                        ensure_ascii=False,
                    ),
                    file=sys.stderr,
                    flush=True,
                )
            if all(counts[name] >= args.max_per_category for name, _ in CATEGORIES):
                break
            for path in iter_files(customer_folder):
                category = classify(path.name)
                source_path = str(path)
                if (
                    not category
                    or counts[category] >= args.max_per_category
                    or source_path in existing_paths
                ):
                    continue
                try:
                    stat = path.stat()
                except OSError:
                    continue
                record = {
                    "category": category,
                    "source_path": source_path,
                    "suffix": path.suffix.lower(),
                    "size_bytes": stat.st_size,
                    "modified_utc": datetime.fromtimestamp(
                        stat.st_mtime, timezone.utc
                    ).isoformat(),
                    "annotation_status": "pending",
                }
                records.append(record)
                existing_paths.add(source_path)
                counts[category] += 1
                stream.write(json.dumps(record, ensure_ascii=False) + "\n")
            stream.flush()
    print(
        json.dumps(
            {
                "total": len(records),
                "counts": counts,
                "scanned_folders": scanned_folders,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
