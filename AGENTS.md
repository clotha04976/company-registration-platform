# Repository Guidelines

## Project Structure & Module Organization

Application pages, styles, and route handlers live in `app/`; case APIs follow paths such as `app/api/cases/[id]/route.ts`. Shared extraction utilities are in `lib/`, declarations in `types/`, database code in `db/`, and migrations in `drizzle/`. The local FastAPI/PaddleOCR sidecar and its tests live in `ocr-service/app/` and `ocr-service/tests/`. Cloudflare's worker entry point is `worker/index.ts`; static assets belong in `public/`, and frontend tests in `tests/`.

## Build, Test, and Development Commands

- `npm install` installs the locked dependency set; use Node.js 22.13 or newer.
- `npm run dev` starts the vinext development server with local Cloudflare bindings.
- `npm run build` creates and validates the production build.
- `npm test` builds first, then runs all `tests/*.test.mjs` files with Node's test runner.
- `npm run lint` applies the Next.js Core Web Vitals and TypeScript ESLint rules.
- `npm run db:generate` creates a Drizzle migration after changes to `db/schema.ts`.
- `start-website.bat` starts both the website and local identity OCR service.
- `ocr-service\.venv\Scripts\python -m unittest discover -s tests` runs OCR tests from `ocr-service\`.

## Coding Style & Naming Conventions

Use TypeScript/TSX for application code, ES modules, two-space indentation, semicolons, and double quotes. The TypeScript configuration is strict; avoid untyped escape hatches and keep imports compatible with bundler resolution. Use PascalCase for React components, camelCase for variables and functions, and kebab-case for feature files (for example, `approval-tracking.tsx`). Follow framework route names exactly (`page.tsx`, `layout.tsx`, and `route.ts`). Run `npm run lint` before submitting changes.

## Testing Guidelines

Frontend tests use `node:test`; OCR tests use Python `unittest`. Name files `<feature>.test.mjs` or `test_<feature>.py`. Add focused assertions for API validation, extraction behavior, and rendered HTML. There is no numeric coverage threshold; every bug fix should include a regression test.

## Commit & Pull Request Guidelines

Recent commits use short, imperative subjects such as `Recognize identity card details on upload`. Keep commits focused. Pull requests should explain the outcome, summarize implementation and database changes, link issues, and list validation. Include screenshots for UI changes and generated `drizzle/` artifacts with schema changes.

## Security & Configuration

Keep secrets in ignored `.env*` files; never commit credentials or real Cloudflare resource IDs. Treat workspace identity headers as untrusted input and use `app/chatgpt-auth.ts` for sign-in flows. Do not create routes for the reserved authentication paths documented in `README.md`.
