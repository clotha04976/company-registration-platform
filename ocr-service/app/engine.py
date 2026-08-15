from __future__ import annotations

import os
import threading
import time
from dataclasses import asdict, dataclass
from typing import Literal

import cv2
import numpy as np

from .identity import (
    OcrToken,
    classify_side,
    date_consistency_warnings,
    decode_barcode_national_id,
    detect_card_candidates,
    extract_address,
    extract_birth_date,
    extract_issue_date,
    extract_name,
    extract_national_id,
    refine_document_corners,
)


@dataclass
class CardResult:
    side: str
    name: str = ""
    national_id: str = ""
    national_id_source: str = ""
    birth_date: str = ""
    issue_date: str = ""
    address: str = ""
    confidence: float = 0.0
    barcode_format: str = ""


class IdentityOcrEngine:
    def __init__(self) -> None:
        self._ocr = None
        self._lock = threading.Lock()

    def _load(self):
        if self._ocr is not None:
            return self._ocr
        os.environ.setdefault("FLAGS_use_mkldnn", "0")
        os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "BOS")
        import paddle
        from paddleocr import PaddleOCR

        configured_device = os.getenv("OCR_DEVICE", "").strip()
        if configured_device:
            device = configured_device
        else:
            device = (
                "gpu:0"
                if paddle.is_compiled_with_cuda()
                and paddle.device.cuda.device_count() > 0
                else "cpu"
            )

        self._ocr = PaddleOCR(
            device=device,
            enable_mkldnn=os.getenv("OCR_ENABLE_MKLDNN", "false").lower() == "true",
            text_detection_model_name="PP-OCRv6_small_det",
            text_recognition_model_name="PP-OCRv6_small_rec",
            use_doc_orientation_classify=True,
            use_doc_unwarping=False,
            use_textline_orientation=True,
        )
        return self._ocr

    @staticmethod
    def _tokens(result) -> list[OcrToken]:
        tokens: list[OcrToken] = []
        for page in result:
            data = page.json.get("res", {})
            texts = data.get("rec_texts", [])
            scores = data.get("rec_scores", [])
            boxes = data.get("rec_boxes", [])
            for index, text in enumerate(texts):
                box = boxes[index] if index < len(boxes) else (0, index * 20, 100, index * 20 + 16)
                tokens.append(OcrToken(str(text), float(scores[index]) if index < len(scores) else 0.0, tuple(map(float, box))))
        return sorted(tokens, key=lambda token: (round(token.center_y / max(token.height, 1)), token.center_x))

    def _recognize_card(self, image: np.ndarray, requested_side: str) -> CardResult:
        ocr = self._load()
        tokens = self._tokens(ocr.predict(input=image))
        texts = [token.text for token in tokens]
        ocr_id = extract_national_id(texts)
        barcode_id, barcode_format = (
            decode_barcode_national_id(image)
            if not ocr_id and requested_side != "front"
            else ("", "")
        )
        national_id = ocr_id or barcode_id
        address = extract_address(tokens)
        detected_side = classify_side(tokens, national_id, address)
        side = requested_side if requested_side in ("front", "back") else detected_side
        return CardResult(
            side=side,
            name=extract_name(tokens) if side != "back" else "",
            national_id=national_id,
            national_id_source="ocr" if ocr_id else ("barcode" if barcode_id else ""),
            birth_date=extract_birth_date(tokens) if side != "back" else "",
            issue_date=extract_issue_date(tokens) if side != "back" else "",
            address=address if side != "front" else "",
            confidence=round(sum(token.score for token in tokens) / len(tokens), 4) if tokens else 0.0,
            barcode_format=barcode_format,
        )

    def recognize(self, images: list[np.ndarray], requested_side: Literal["auto", "front", "back", "combined"]) -> dict:
        started = time.perf_counter()
        with self._lock:
            cards: list[np.ndarray] = []
            if requested_side == "combined":
                for image in images:
                    cards.extend(detect_card_candidates(image))
            if not cards:
                cards = images
            refined_cards = []
            refined_count = 0
            for card in cards:
                refined, used = refine_document_corners(card)
                refined_cards.append(refined)
                refined_count += int(used)
            cards = refined_cards
            results = [self._recognize_card(card, "auto" if requested_side == "combined" else requested_side) for card in cards]

        name = next((item.name for item in results if item.name), "")
        national_id = next((item.national_id for item in results if item.national_id), "")
        national_id_source = next((item.national_id_source for item in results if item.national_id == national_id), "")
        birth_date = next((item.birth_date for item in results if item.birth_date), "")
        issue_date = next((item.issue_date for item in results if item.issue_date), "")
        address = next((item.address for item in results if item.address), "")
        warnings = []
        if requested_side == "combined" and len(cards) < 2:
            warnings.append("合併頁未穩定偵測到兩張卡片，已使用可用候選或整頁辨識")
        if not national_id:
            warnings.append("未取得通過 checksum 的身分證字號")
        warnings.extend(date_consistency_warnings(birth_date, issue_date))
        return {
            "status": "success" if national_id and (name or address) else "review",
            "model": "PP-OCRv6-small",
            "requested_side": requested_side,
            "detected_cards": len(cards),
            "docaligner_refined_cards": refined_count,
            "name": name,
            "national_id": national_id,
            "national_id_source": national_id_source,
            "birth_date": birth_date,
            "issue_date": issue_date,
            "address": address,
            "confidence": max((item.confidence for item in results), default=0.0),
            "cards": [asdict(item) for item in results],
            "warnings": warnings,
            "duration_ms": round((time.perf_counter() - started) * 1000),
        }


engine = IdentityOcrEngine()
