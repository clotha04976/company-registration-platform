from __future__ import annotations

import asyncio
import io
import os
from typing import Literal

import cv2
import numpy as np
import pypdfium2 as pdfium
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .engine import engine

MAX_FILE_SIZE = 25 * 1024 * 1024
ALLOWED_EXTENSIONS = {"pdf", "jpg", "jpeg", "png"}

app = FastAPI(title="公司登記身分證 OCR", version="0.1.0")
origins = [origin.strip() for origin in os.getenv(
    "OCR_ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173",
).split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def decode_images(data: bytes, extension: str) -> list[np.ndarray]:
    if extension == "pdf":
        document = pdfium.PdfDocument(io.BytesIO(data))
        if len(document) > 10:
            raise HTTPException(400, "身分證 PDF 不可超過 10 頁")
        images = []
        for page in document:
            rgb = np.asarray(page.render(scale=2.2).to_pil().convert("RGB"))
            images.append(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        return images
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(400, "無法解碼影像")
    return [image]


@app.get("/health")
def health() -> dict:
    try:
        import paddle

        device = (
            os.getenv("OCR_DEVICE", "").strip()
            or (
                "gpu:0"
                if paddle.is_compiled_with_cuda()
                and paddle.device.cuda.device_count() > 0
                else "cpu"
            )
        )
    except Exception:
        device = os.getenv("OCR_DEVICE", "cpu")
    return {
        "status": "ok",
        "model": "PP-OCRv6-small",
        "device": device,
        "stores_uploads": False,
    }


@app.post("/identity/recognize")
async def recognize_identity(
    file: UploadFile = File(...),
    side: Literal["auto", "front", "back", "combined"] = Form("auto"),
) -> dict:
    filename = file.filename or "upload"
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, "僅接受 PDF、JPG、JPEG、PNG")
    data = await file.read(MAX_FILE_SIZE + 1)
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(413, "檔案不可超過 25 MB")
    images = decode_images(data, extension)
    return await asyncio.to_thread(engine.recognize, images, side)
