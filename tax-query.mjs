import { randomUUID } from "node:crypto";

const TAX_ROOT = "https://www.etax.nat.gov.tw/etwmain";

const BUREAUS = {
  A05: { code: "A05", name: "臺北國稅局", shortName: "臺北", path: "a05" },
  H01: { code: "H01", name: "北區國稅局", shortName: "北區", path: "h01" },
  B01: { code: "B01", name: "中區國稅局", shortName: "中區", path: "b01" },
  D01: { code: "D01", name: "南區國稅局", shortName: "南區", path: "d01" },
  E01: { code: "E01", name: "高雄國稅局", shortName: "高雄", path: "e01" },
};

export class TaxQueryError extends Error {
  constructor(message, { status = 502, code = "UPSTREAM_ERROR" } = {}) {
    super(message);
    this.name = "TaxQueryError";
    this.status = status;
    this.code = code;
  }
}

function clean(value, maxLength = 300) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function bureau(code) {
  const value = BUREAUS[String(code || "").toUpperCase()];
  if (!value) throw new TaxQueryError("請選擇正確的國稅局", { status: 400, code: "INVALID_BUREAU" });
  return value;
}

async function request(fetchImpl, url, options, failureMessage) {
  try {
    return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(18_000) });
  } catch {
    throw new TaxQueryError(failureMessage, { code: "NETWORK_ERROR" });
  }
}

async function jsonBody(response) {
  try { return await response.json(); }
  catch { return {}; }
}

export function taxQueryUrl(bureauCode) {
  const selected = bureau(bureauCode);
  return `${TAX_ROOT}/etw213w/${selected.path}`;
}

export async function createTaxCaptcha({ bureauCode }, { fetchImpl = fetch } = {}) {
  const selected = bureau(bureauCode);
  const nonce = Buffer.from(randomUUID()).toString("base64url");
  const tokenResponse = await request(fetchImpl, `${TAX_ROOT}/api/captcha/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Language": "zh-TW,zh;q=0.9",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
    },
    body: JSON.stringify({ nonce }),
  }, "目前無法取得國稅局驗證碼，請稍後再試");
  const tokenPayload = await jsonBody(tokenResponse);
  if (!tokenResponse.ok || !tokenPayload.token) {
    throw new TaxQueryError("目前無法取得國稅局驗證碼，請稍後再試", { code: "CAPTCHA_UNAVAILABLE" });
  }

  const token = clean(tokenPayload.token, 1000);
  const imageResponse = await request(fetchImpl, `${TAX_ROOT}/api/captcha/image?t=${encodeURIComponent(token)}`, {
    method: "GET",
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      Referer: taxQueryUrl(selected.code),
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
    },
  }, "目前無法載入國稅局驗證碼，請稍後再試");
  if (!imageResponse.ok) {
    throw new TaxQueryError("目前無法載入國稅局驗證碼，請稍後再試", { code: "CAPTCHA_UNAVAILABLE" });
  }

  return {
    bureauCode: selected.code,
    bureauName: selected.name,
    nonce,
    token,
    image: Buffer.from(await imageResponse.arrayBuffer()),
    mimeType: clean(imageResponse.headers.get("content-type") || "image/png", 100),
    expiresAt: Date.now() + 110_000,
  };
}

export async function queryTaxCases({ bureauCode, taxId, businessName, captchaText, captcha }, { fetchImpl = fetch } = {}) {
  const selected = bureau(bureauCode);
  const normalizedTaxId = clean(taxId, 8);
  const normalizedName = clean(businessName, 200);
  const normalizedCaptcha = clean(captchaText, 6);
  if (!/^\d{8}$/.test(normalizedTaxId)) {
    throw new TaxQueryError("統一編號需為 8 碼數字", { status: 400, code: "INVALID_TAX_ID" });
  }
  if (!normalizedName) throw new TaxQueryError("請填寫營業人名稱", { status: 400, code: "MISSING_NAME" });
  if (!normalizedCaptcha || !captcha?.nonce || !captcha?.token) {
    throw new TaxQueryError("請輸入圖形驗證碼", { status: 400, code: "MISSING_CAPTCHA" });
  }

  const payload = {
    ban: normalizedTaxId,
    banNm: normalizedName,
    rdcDate: "",
    applyItemStatus: "",
    captchaText: normalizedCaptcha,
    captcha: {
      input: normalizedCaptcha,
      nonce: clean(captcha.nonce, 200),
      token: clean(captcha.token, 1200),
    },
  };
  const response = await request(fetchImpl, `${TAX_ROOT}/api/functions/etw213w/searchPage/${selected.code}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Language": "zh-TW,zh;q=0.9",
      "Content-Type": "application/json",
      Referer: taxQueryUrl(selected.code),
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
    },
    body: JSON.stringify(payload),
  }, "目前無法連線至國稅局進度查詢，請稍後再試");
  const body = await jsonBody(response);
  if (response.status === 403 && body.captchaErr) {
    throw new TaxQueryError(clean(body.captchaErr, 200) || "驗證碼錯誤", { status: 400, code: "CAPTCHA_INVALID" });
  }
  if (!response.ok) {
    const message = clean(body?.error?.message || body?.detail || body?.message, 300)
      || `國稅局網站暫時無法查詢（HTTP ${response.status}）`;
    throw new TaxQueryError(message, { status: response.status >= 500 ? 502 : 400 });
  }
  if (body.error) {
    const details = Array.isArray(body.error.details) ? body.error.details.map((item) => item?.message).filter(Boolean) : [];
    throw new TaxQueryError(clean(details.join("；") || body.error.message, 500) || "查詢條件不正確", {
      status: 400, code: "INVALID_INPUT",
    });
  }
  if (body.etwt398List === "N" || !body.etwt398List) return [];
  if (!Array.isArray(body.etwt398List)) {
    throw new TaxQueryError("國稅局查詢結果格式已變更，暫時無法帶入", { code: "LAYOUT_CHANGED" });
  }
  return body.etwt398List.map((row) => {
    const values = Array.isArray(row) ? row : [];
    return {
      taxId: clean(values[0], 8),
      businessName: clean(values[1], 200),
      receivedDate: clean(values[2], 30),
      receiptNo: clean(values[3], 100),
      caseType: clean(values[4], 200),
      officialStatus: clean(values[5], 100),
      bureauCode: selected.code,
      bureauName: selected.name,
      progressUrl: taxQueryUrl(selected.code),
    };
  }).filter((item) => item.receiptNo || item.receivedDate || item.officialStatus);
}

export const taxBureaus = Object.freeze(Object.fromEntries(
  Object.entries(BUREAUS).map(([code, value]) => [code, Object.freeze({ ...value, url: taxQueryUrl(code) })]),
));
