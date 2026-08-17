# 公司設立登記智慧精靈

本機執行的公司設立登記案件管理工具。前端是 Vite + React SPA，後端是兩個本機
FastAPI 服務：案件 API 與身分證 OCR sidecar。資料存放在本機 SQLite。

## 架構

| 元件 | 位置 | 連接埠 |
| --- | --- | --- |
| 前端 SPA | `app/`、`lib/` | 5173（`npm run preview` 為 4173） |
| 案件 API | `api-service/` | 8690 |
| 身分證 OCR | `ocr-service/` | 8689 |
| SQLite 資料庫 | `api-service/data/cases.db` | — |

前端以相對路徑呼叫 `/api/...`，由 Vite 的 proxy 轉發到案件 API，因此開發與正式
環境的程式碼不需要區分位址。

## 需求

- Node.js `>=22.13.0`
- Python 3.10 或 3.11

## 快速開始

雙擊 `start-website.bat`，開啟 http://localhost:5173 。
首次執行會建立 Python 虛擬環境並下載 PP-OCRv6 模型，時間較久。

三個服務都跑在**同一個視窗**裡：`npm run dev` 啟動 Vite，Vite 再把案件 API 與身分證
OCR 當成子程序帶起來（`build/python-services-plugin.ts`），日誌以 `[case-api]`、
`[identity-ocr]` 前綴區分。關掉視窗時子程序會一併結束——它們會輪詢父程序是否還在，
所以連強制關閉也不會留下佔用埠的殘留程序。

已經在監聽的埠會被沿用而不是重複啟動，因此下列指令仍可單獨執行（例如只想重啟某個
服務，或想讓它獨立開一個視窗看日誌）：

```powershell
api-service\run-api-service.bat
ocr-service\run-ocr-service.bat
```

`VITE_IDENTITY_OCR_URL` 一旦指向本機以外的位址（例如辨識工作站），Vite 就不會再啟動
本機 OCR 服務。

## 常用指令

- `npm run dev`：啟動前端開發伺服器（含 `/api` proxy）
- `npm run build`：型別檢查並建置到 `dist/`
- `npm run preview`：預覽建置結果
- `npm test`：建置後執行 `tests/*.test.mjs`
- `npm run lint`：ESLint 檢查
- `api-service\.venv\Scripts\python -m unittest discover -s tests`：案件 API 測試
- `ocr-service\.venv\Scripts\python -m unittest discover -s tests`：OCR 測試

## 資料庫

案件 API 啟動時會自動建立資料表與 10 筆承辦人種子資料，不需要額外的 migration
步驟。資料庫預設位於 `api-service/data/cases.db`，可用 `CASES_DATABASE_PATH`
指定其他路徑。該目錄已被 Git 忽略。

資料表：`employees`、`cases`、`case_approval_documents`、`registration_card_tracking`。
核准公文與登記事項卡的紀錄會隨案件一併刪除（`ON DELETE CASCADE`，連線時啟用
`PRAGMA foreign_keys`）。

## 本機身分證 OCR

OCR 服務只監聽 `127.0.0.1:8689`，在記憶體中處理上傳檔案，不保留身分證影像。
步驟 1 提供正面、反面與正反面合併 A4 三種上傳欄位。正面辨識取得姓名、通過檢查碼
驗證的身分證字號與民國出生日期；反面辨識取得地址，並以條碼作為證號的備援來源。
服務無法連線時，網站會顯示明確的連線錯誤，而不會退回不可靠的瀏覽器 OCR。

服務預設以 **CPU** 執行，約 6 秒辨識一張，不需要與 CUDA 版本相符的 paddle。每次
請求只處理一張證件，這個延遲對本機備援的定位是可接受的。要改用 GPU 需安裝
`requirements-gpu.txt`（或以 `OCR_GPU=1` 執行 `setup-venv.bat`）**並且**設定
`OCR_DEVICE=gpu:0`——只裝 GPU 版不會自動切換裝置。

若要改指向其他位址，設定 `VITE_IDENTITY_OCR_URL`（Vite 只會暴露 `VITE_` 開頭的
環境變數），並把網站來源加入 `OCR_ALLOWED_ORIGINS`。未加上驗證與傳輸加密前，
請勿將 OCR 服務公開對外。

案件 API 的跨來源設定為 `CASES_ALLOWED_ORIGINS`。透過 Vite proxy 使用時不會觸發
跨來源請求，該設定僅在前端直接呼叫 8690 埠時才需要。
