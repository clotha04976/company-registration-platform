# 工商案件管理台帳

以案件進度為核心的本機工商登記工作台。React 負責台帳、完整進度、OCR 資料確認與文件產出；Node.js 負責案件 API、官方進度查詢、提醒、請款與 SQLite；Python 只負責 PaddleOCR 身分證辨識與 ddddocr 驗證碼辨識。

## 技術棧

| 層級 | 技術 | 用途 |
| --- | --- | --- |
| 前端 | React 19、TypeScript、Vite 8 | 案件台帳、資料準備、文件產生、核准追蹤 |
| 案件後端 | Node.js 22.17+ 內建 HTTP、`node:sqlite` | REST API、完整進度、提醒、收款、備份 |
| RPA 查詢 | Node.js `fetch` + ddddocr | 市政府與國稅局官方進度；驗證碼本機辨識，失敗時人工修正 |
| OCR | FastAPI、PaddleOCR、ddddocr | 身分證辨識 sidecar；國稅局驗證碼使用輕量常駐 Python worker |
| 資料庫 | SQLite | 本機案件、歷程、資料準備與核准追蹤 |
| 文件處理 | pdf.js、Tesseract.js、pdf-lib、OOXML、fflate | PDF 擷取、一般文件 OCR、DOCX 與 ZIP 產出 |

Cloudflare D1 與 Drizzle 已不在此架構中。案件 API 也不再由 FastAPI 提供；FastAPI 只服務需要 Python/Paddle 生態的 OCR。

## 快速開始

需求：Node.js 22.17 以上，以及 OCR 所需的 Python 3.10 或 3.11。

雙擊 `start-website.bat`，或執行：

```powershell
npm install
npm run dev
```

開發網址是 http://localhost:5173 。Vite 會啟動 Node ERP 服務（5566）並把 `/api` 代理過去，也會在需要時啟動 OCR（8689）。若 5566 已由正確服務監聽，會沿用該服務。

正式本機模式：

```powershell
npm run build
npm start
```

開啟 http://localhost:5566 。

## 常用指令

- `npm run dev`：啟動 React、Node ERP 與本機 OCR 開發環境
- `npm run build`：TypeScript 型別檢查並建置 `dist/`
- `npm test`：建置並執行 Node 測試
- `npm run lint`：執行 ESLint
- `npm run backup`：建立 SQLite 備份
- `ocr-service\run-ocr-service.bat`：單獨啟動 OCR
- `ocr-service\setup-captcha-venv.bat`：單獨安裝國稅局驗證碼辨識環境
- `ocr-service\.venv\Scripts\python -m unittest discover -s tests`：OCR 測試

## 資料與隱私

資料庫預設位於 `data/cases.sqlite`，備份位於 `backups/`；兩者都已被 Git 忽略。可用 `APP_DATA_DIR` 與 `APP_BACKUP_DIR` 改位置。

資料準備功能會把 OCR 後經人工確認的文字欄位存到案件中，並同步公司名稱、負責人、預查編號、地址與資本額。身分證原始圖片只在瀏覽器與本機 OCR 記憶體中處理，不寫入 SQLite、不放進 Git。OCR 服務只監聽 `127.0.0.1:8689`；未加驗證與 TLS 前不要公開到網際網路。

## 為什麼 OCR 仍用小型 API

如果每張圖都執行一次 Python 腳本，PaddleOCR 模型會反覆載入，等待時間與記憶體抖動都比較大。現在的 FastAPI sidecar 沒有承擔 ERP 邏輯，只讓模型常駐並接收單張圖片；這比把整套案件後端改成 Python 簡單，也比每次執行腳本穩定。

## 功能分層

1. 案件台帳是主入口：基本資料、完整進度、官方查詢、提醒、請款與收款。
2. 每筆案件可進入「資料準備與 OCR」，辨識後人工確認並儲存欄位。
3. 確認資料可產出 DOCX/ZIP，完成後進入市府、國稅局公文與登記事項卡追蹤。
4. 國稅局核准公文標記為「已收到／已歸檔」後，最後一步會開放「購票證明申請套版」，可選擇受任事務所並下載四頁 Word。

## 記帳士事務所與購票證明

左側「事務所設定」可建立多間記帳士／會計師事務所，包含統編、負責人、地址、電話、專業資格、媒體代號與證書字號；可指定一間預設值，但每個案件仍可個別選擇受任事務所與第 4 頁專業代理人事務所。

購票證明資料會保存在案件自己的 `case_purchase_proof` 紀錄，Word 使用已去除固定事務所個資的通用範本，在下載當下才從 SQLite 主檔帶入。案件未收到國稅局核准公文時，後端會拒絕產生文件，避免流程跳步。

一般 PDF 擷取與文件分類在瀏覽器執行；身分證辨識走本機 OCR。國稅局查詢會依營業地址自動選擇五區國稅局，使用本機 ddddocr 辨識官方驗證碼並直接查詢；連續辨識失敗時才顯示圖片讓承辦人修正。
