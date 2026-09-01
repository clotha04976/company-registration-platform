from __future__ import annotations

import base64
import json
import re
import sys

import ddddocr


ocr = ddddocr.DdddOcr(show_ad=False)


def recognize(image_base64: str) -> str:
    image = base64.b64decode(image_base64, validate=True)
    text = str(ocr.classification(image) or "")
    return re.sub(r"[^0-9A-Za-z]", "", text).upper()[:6]


for raw_line in sys.stdin:
    payload = {}
    try:
        payload = json.loads(raw_line)
        result = {"id": payload.get("id", ""), "text": recognize(payload.get("image", ""))}
    except Exception as error:  # Keep the worker alive so the next captcha can retry.
        result = {"id": payload.get("id", "") if isinstance(payload, dict) else "", "error": str(error)}
    print(json.dumps(result, ensure_ascii=False), flush=True)
