const ZIP5_API_URL = "https://zip5.5432.tw/zip5json.py";
const cache = new Map();
let lastLookupAt = 0;

export function normalizePostalLookupAddress(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/\d{8,}$/, "")
    .trim();
}

export async function lookupTaiwanPostalCode(address, options = {}) {
  const normalized = normalizePostalLookupAddress(address);
  if (!normalized || !/[縣市].+[路街巷弄號]/.test(normalized)) return "";
  if (cache.has(normalized)) return cache.get(normalized);

  const minIntervalMs = options.minIntervalMs ?? 2500;
  const waitMs = Math.max(0, minIntervalMs - (Date.now() - lastLookupAt));
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    lastLookupAt = Date.now();
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(
      `${options.endpoint ?? ZIP5_API_URL}?adrs=${encodeURIComponent(normalized)}`,
      { signal: controller.signal },
    );
    if (!response.ok) return "";
    const result = await response.json();
    const postalCode = /^\d{6}$/.test(String(result.zipcode6 ?? ""))
      ? String(result.zipcode6)
      : /^\d{5}$/.test(String(result.zipcode ?? ""))
        ? String(result.zipcode)
        : "";
    cache.set(normalized, postalCode);
    return postalCode;
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}
