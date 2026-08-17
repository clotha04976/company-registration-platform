const DEFAULT_IDENTITY_OCR_URL = "http://127.0.0.1:8689";
// Vite only exposes VITE_-prefixed variables, and there is no `process` in the
// browser. Node test runs have no `import.meta.env` at all.
const environment = import.meta.env ?? {};

export async function recognizeIdentityWithService(
  file,
  side = "auto",
  options = {},
) {
  const baseUrl = String(
    options.baseUrl ??
      environment.VITE_IDENTITY_OCR_URL ??
      DEFAULT_IDENTITY_OCR_URL,
  ).replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 120_000);
  const body = new FormData();
  body.append("file", file, file.name);
  body.append("side", side);
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `${baseUrl}/identity/recognize`,
      { method: "POST", body, signal: controller.signal },
    );
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.detail || `OCR 服務錯誤 (${response.status})`);
    }
    const result = await response.json();
    return {
      status: result.status,
      model: result.model,
      name: result.name ?? "",
      nationalId: result.national_id ?? "",
      nationalIdSource: result.national_id_source ?? "",
      birthDate: result.birth_date ?? "",
      address: result.address ?? "",
      confidence: result.confidence ?? 0,
      detectedCards: result.detected_cards ?? 0,
      warnings: result.warnings ?? [],
      durationMs: result.duration_ms ?? 0,
    };
  } finally {
    window.clearTimeout(timeout);
  }
}
