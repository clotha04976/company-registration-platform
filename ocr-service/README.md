# 身分證 OCR 服務

FastAPI sidecar for local or private-network identity-card recognition. Uploads are processed in memory and are not saved.

## Run locally

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8689
```

The first run downloads the official `PP-OCRv6_small_det` and `PP-OCRv6_small_rec` models. On an NVIDIA Windows workstation, install `requirements-gpu.txt` instead; the service then selects `gpu:0` automatically. `run-ocr-service.bat` chooses the GPU requirements for a new environment when `nvidia-smi` is available. Set `OCR_DEVICE=cpu` or `OCR_DEVICE=gpu:0` only to override auto-detection.

`POST /identity/recognize` accepts one `file` and a `side` value of `front`, `back`, `combined`, or `auto`. The response includes name, checksum-validated national ID, ROC birth date, address, barcode fallback source, per-card results, and warnings.

For optional DocAligner refinement, install `requirements-docaligner.txt` after providing the native TurboJPEG runtime, then set `OCR_USE_DOCALIGNER=true`. Import, model, or native-library failures automatically fall back to OpenCV perspective correction.

## Private property-document dataset

Build a path-only manifest without copying customer documents:

```powershell
.\.venv\Scripts\python tools\collect_property_documents.py "\\server\share\Customers" "..\.private\property-ocr\source-manifest.jsonl" --max-per-category 50
```

Generate GPU-assisted pseudo-labels for `property_address` and `tax_registration_number`:

```powershell
.\.venv\Scripts\python tools\bootstrap_property_labels.py "..\.private\property-ocr\source-manifest.jsonl" "..\.private\property-ocr\annotation-queue.jsonl"
```

The `.private/` directory is ignored by Git. Pseudo-labels remain `pending_review` and must be visually verified before training or evaluation.
