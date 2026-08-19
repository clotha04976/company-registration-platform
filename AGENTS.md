# Repository Guidelines

## Project Structure & Module Organization

The frontend is a Vite + React SPA. `index.html` is the entry document, `app/main.tsx`
mounts `app/page.tsx`, and the remaining screens live in `app/*.tsx` with styles in
`app/globals.css`. Shared extraction utilities are in `lib/`, declarations in `types/`,
and frontend tests in `tests/`. Static assets belong in `public/`.

`lib/business-items.mjs` is generated, not hand-written: rerun
`node build/build-business-items.mjs` after refreshing
`BusinessScopeCategories.json` from the GCIS open data set.

Two local FastAPI services back the site. The case API lives in `api-service/app/`
(`main.py` wires the app, `cases.py` holds the routes, `db.py` owns the SQLite schema)
with tests in `api-service/tests/`. The identity OCR sidecar lives in `ocr-service/app/`
with tests in `ocr-service/tests/`.

## Build, Test, and Development Commands

- `npm install` installs the locked dependency set; use Node.js 22.13 or newer.
- `npm run dev` starts Vite on port 5173, proxies `/api` to the case API, and runs both
  FastAPI services as child processes so the whole stack shares one terminal. A port that
  is already listening is reused rather than rebound. See `build/python-services-plugin.ts`.
- `npm run build` type-checks with `tsc --noEmit` and builds to `dist/`.
- `npm test` builds first, then runs all `tests/*.test.mjs` files with Node's test runner.
- `npm run lint` applies the ESLint flat config (typescript-eslint and react-hooks).
- `start-website.bat` provisions the virtual environments, then hands off to `npm run dev`.
- `api-service\run-api-service.bat` and `ocr-service\run-ocr-service.bat` still run a single
  service on its own when you want its logs in a separate window.
- `api-service\.venv\Scripts\python -m unittest discover -s tests` runs case API tests.
- `ocr-service\.venv\Scripts\python -m unittest discover -s tests` runs OCR tests.

## Coding Style & Naming Conventions

Use TypeScript/TSX for application code, ES modules, two-space indentation, semicolons,
and double quotes. The TypeScript configuration is strict; avoid untyped escape hatches.
Use PascalCase for React components, camelCase for variables and functions, and
kebab-case for feature files (for example, `approval-tracking.tsx`).

Python services use `from __future__ import annotations`, type hints, and four-space
indentation. Keep user-facing error messages in Traditional Chinese, and keep the API
reply shape as `{"error": "..."}` so the frontend keeps working unchanged. Only
`VITE_`-prefixed environment variables reach the browser.

## Testing Guidelines

Frontend tests use `node:test`; Python tests use `unittest`. Name files
`<feature>.test.mjs` or `test_<feature>.py`. Case API behaviour belongs in
`api-service/tests/test_cases.py` as real request tests; `tests/*.test.mjs` additionally
assert that frontend copy and backend SQL stay in sync by matching source text. When a
test reads a Python file, join adjacent string literals first, because long SQL is split
across lines. There is no numeric coverage threshold; every bug fix should include a
regression test.

## Commit & Pull Request Guidelines

Recent commits use short, imperative subjects such as `Recognize identity card details on
upload`. Keep commits focused. Pull requests should explain the outcome, summarize
implementation and database changes, link issues, and list validation. Include
screenshots for UI changes.

## Security & Configuration

Keep secrets in ignored `.env*` files. The SQLite database under `api-service/data/`
holds customer case data and is Git-ignored, as is `.private/`. Both FastAPI services
bind to `127.0.0.1` only; do not expose them without authentication and transport
security.
