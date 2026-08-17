# 身分證 OCR 服務

FastAPI sidecar for local or private-network identity-card recognition. Uploads are processed in memory and are not saved.

## Run locally

`run-ocr-service.bat` supports Python 3.10 and 3.11. It prefers 3.11 when both
are installed and automatically falls back to 3.10.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8689
```

The first run downloads the official `PP-OCRv6_small_det` and `PP-OCRv6_small_rec` models.

The service runs on the CPU by default, which takes roughly 6 seconds per card and needs no CUDA-matched Paddle build. Recognition handles one card per request, so that latency is acceptable for the local fallback role. To use a GPU, install `requirements-gpu.txt` (or run `setup-venv.bat` with `OCR_GPU=1`) and set `OCR_DEVICE=gpu:0`; installing the GPU build alone does not switch devices.

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

Cache full-page PP-OCRv6 output once, then evaluate region and extraction rules without
rerunning the models:

```powershell
.\.venv\Scripts\python tools\cache_property_ocr.py "..\.private\property-ocr\source-manifest.jsonl" "..\.private\property-ocr\ocr-cache.jsonl"
.\.venv\Scripts\python tools\evaluate_property_cache.py "..\.private\property-ocr\ocr-cache.jsonl"
```

For PicoDet annotation, save orientation-corrected pages while caching and export
PP-OCRv6 pseudo-labels for review in LabelMe:

```powershell
.\.venv\Scripts\python tools\cache_property_ocr.py "..\.private\property-ocr\source-manifest.jsonl" "..\.private\property-ocr\ocr-cache.jsonl" --image-dir "..\.private\property-ocr\pages"
.\.venv\Scripts\python tools\export_property_labelme.py "..\.private\property-ocr\ocr-cache.jsonl" "..\.private\property-ocr\pages" "..\.private\property-ocr\labelme"
```

For a larger NAS collection, scan in resumable folder batches, remove byte-identical
documents, and exclude precheck forms before OCR:

```powershell
.\.venv\Scripts\python tools\collect_property_documents.py "\\server\share\Customers" "..\.private\property-ocr\source-manifest.jsonl" --max-per-category 100 --max-folders 100
.\.venv\Scripts\python tools\dedupe_property_manifest.py "..\.private\property-ocr\source-manifest.jsonl" "..\.private\property-ocr\training-manifest.jsonl" --exclude-category precheck
```

The manifest, OCR cache, and annotation queue contain customer data and must remain
under the ignored `.private` directory.

The `.private/` directory is ignored by Git. Pseudo-labels remain `pending_review` and must be visually verified before training or evaluation.

To review the generated property labels, run `review_property_labels.bat` from
the repository root. In LabelMe, correct or delete the `property_address` and
`tax_registration_number` rectangles, merge multi-line address text into one
rectangle, and save each JSON before training.
