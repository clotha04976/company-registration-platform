from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Remove byte-identical documents from a private dataset manifest."
    )
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--exclude-category",
        action="append",
        default=[],
        help="Drop a category from the output; repeatable.",
    )
    args = parser.parse_args()
    records = [
        json.loads(line)
        for line in args.manifest.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    seen = set()
    output = []
    summary: Counter[str] = Counter()
    for record in records:
        category = record["category"]
        if category in args.exclude_category:
            summary["excluded_categories"] += 1
            continue
        path = Path(record["source_path"])
        try:
            key = (category, digest(path))
        except OSError:
            summary["unreadable_files"] += 1
            continue
        if key in seen:
            summary["duplicates"] += 1
            continue
        seen.add(key)
        record["sha256"] = key[1]
        output.append(record)
        summary[category] += 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        for record in output:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
    temporary.replace(args.output)
    print(json.dumps({"total": len(output), "summary": summary}, ensure_ascii=False))


if __name__ == "__main__":
    main()
