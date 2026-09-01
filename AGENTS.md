# Repository Guidelines

## Project Structure

The frontend is a Vite + React SPA. `app/cases-dashboard.tsx` is the ERP entry point and `app/page.tsx` owns the case-scoped OCR/document wizard. Shared extraction and document-generation utilities live in `lib/`; static assets are in `public/`.

`server.mjs` is the Node.js ERP backend. It owns the SQLite schema, case/history/billing/preparation/approval APIs, static production serving, and official progress integrations. `official-query.mjs` and `tax-query.mjs` isolate the two official-site adapters. `scripts/backup.mjs` creates SQLite backups.

`ocr-service/` is the only Python service. It is a small FastAPI/PaddleOCR sidecar and must not absorb case-management logic. Uploaded identity images are memory-only.

## Commands

- `npm install` installs the locked dependency set; use Node.js 22.17 or newer.
- `npm run dev` starts Vite, the Node ERP API on 5566, and OCR on 8689.
- `npm run build` type-checks and builds to `dist/`.
- `npm test` builds and runs `tests/*.test.mjs`.
- `npm run lint` runs ESLint.
- `npm run backup` backs up the SQLite database.
- `ocr-service\.venv\Scripts\python -m unittest discover -s tests` runs OCR tests.

## Style and Testing

Use TypeScript/TSX, ES modules, two-space indentation, semicolons, double quotes, and Traditional Chinese user-facing copy. Keep Python type-annotated and four-space indented. Add regression coverage for workflow, persistence, privacy, and document-generation changes.

## Security

Keep `.env*`, `data/`, `backups/`, `.private/`, and uploaded customer documents out of Git. Store only OCR-confirmed fields in SQLite; never persist original identity-card bytes. Services bind locally by default and must not be exposed without authentication and transport security.
