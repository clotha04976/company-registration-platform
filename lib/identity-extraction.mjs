const TAIWAN_ID_LETTER_VALUES = {
  A: 10,
  B: 11,
  C: 12,
  D: 13,
  E: 14,
  F: 15,
  G: 16,
  H: 17,
  I: 34,
  J: 18,
  K: 19,
  L: 20,
  M: 21,
  N: 22,
  O: 35,
  P: 23,
  Q: 24,
  R: 25,
  S: 26,
  T: 27,
  U: 28,
  V: 29,
  W: 32,
  X: 30,
  Y: 31,
  Z: 33,
};

export function normalizeTaiwanNationalId(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function isValidTaiwanNationalId(value) {
  const normalized = normalizeTaiwanNationalId(value);
  if (!/^[A-Z][12]\d{8}$/.test(normalized)) return false;
  const letterValue = TAIWAN_ID_LETTER_VALUES[normalized[0]];
  if (!letterValue) return false;
  const digits = normalized.slice(1).split("").map(Number);
  const sum =
    Math.floor(letterValue / 10) +
    (letterValue % 10) * 9 +
    digits.slice(0, 8).reduce((total, digit, index) => total + digit * (8 - index), 0) +
    digits[8];
  return sum % 10 === 0;
}

const NAME_EXCLUSIONS = new Set([
  "中華民國",
  "出生日期",
  "身分證字號",
  "統一編號",
  "發證日期",
  "戶籍地址",
  "住址",
  "國籍",
  "姓名",
]);

export function isPlausibleTaiwanName(value) {
  const normalized = String(value ?? "").replace(/\s+/g, "").trim();
  return (
    /^[\u3400-\u9fff]{2,4}$/.test(normalized) &&
    !NAME_EXCLUSIONS.has(normalized) &&
    !/(地址|國籍|出生|日期|身分證|民國)/.test(normalized)
  );
}

const extractNationalId = (text) => {
  const candidates = String(text ?? "")
    .toUpperCase()
    .match(/[A-Z](?:[\s\-_.:：]*\d){9}/g);
  for (const candidate of candidates ?? []) {
    const normalized = normalizeTaiwanNationalId(candidate);
    if (isValidTaiwanNationalId(normalized)) return normalized;
  }
  return "";
};

const extractLabeledName = (text) => {
  const lines = String(text ?? "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = line.match(/姓\s*名\s*[:：]?\s*(.*)$/);
    if (!marker) continue;
    const markerIndex = line.search(/姓\s*名/);
    if (/(?:地址|住址)/.test(line.slice(0, markerIndex))) continue;
    const sameLine = marker[1]
      .replace(/(?:身分證|國籍|出生|民國|發證|住址|地址).*$/, "")
      .replace(/[^\u3400-\u9fff\s]/g, "")
      .replace(/\s+/g, "")
      .slice(0, 4);
    if (isPlausibleTaiwanName(sameLine)) return sameLine;
    const nextLine = (lines[index + 1] ?? "")
      .replace(/[^\u3400-\u9fff\s]/g, "")
      .replace(/\s+/g, "");
    if (isPlausibleTaiwanName(nextLine)) return nextLine;
  }
  return "";
};

export function parseTaiwanIdentityText(pagesOrText) {
  const text = Array.isArray(pagesOrText)
    ? pagesOrText.map((page) => String(page?.text ?? "")).join("\n")
    : String(pagesOrText ?? "");
  return {
    nationalId: extractNationalId(text),
    name: extractLabeledName(text),
  };
}

export function selectIdentityResult(orderedFileIds, results) {
  const completed = orderedFileIds.map((id) => results[id]).filter(Boolean);
  if (completed.length < orderedFileIds.length) return { state: "processing" };
  const nameResult = completed.find((item) => item.name);
  const idResult = completed.find((item) =>
    isValidTaiwanNationalId(item.nationalId),
  );
  const birthResult = completed.find((item) => item.birthDate);
  const addressResult = completed.find((item) => item.address);
  if (nameResult && idResult)
    return {
      state: "success",
      name: nameResult.name,
      nationalId: idResult.nationalId,
      sourceFile: idResult.sourceFile,
      birthDate: birthResult?.birthDate ?? "",
      address: addressResult?.address ?? "",
      nationalIdSource: idResult.nationalIdSource ?? "",
    };
  const partial = completed.find(
    (item) => item.name || item.nationalId || item.birthDate || item.address,
  );
  return partial
    ? {
        state: "partial",
        ...partial,
        birthDate: birthResult?.birthDate ?? partial.birthDate ?? "",
        address: addressResult?.address ?? partial.address ?? "",
      }
    : { state: "review" };
}

export function mergeIdentityFields(current, parsed, manual) {
  return {
    ...current,
    representative:
      manual.representative || !parsed?.name
        ? current.representative
        : parsed.name,
    nationalId:
      manual.nationalId || !isValidTaiwanNationalId(parsed?.nationalId)
        ? current.nationalId
        : parsed.nationalId,
  };
}

export function isCompleteIdentityResult(value) {
  return Boolean(
    value?.name && isValidTaiwanNationalId(value?.nationalId),
  );
}

export function selectRotationCandidate(candidates) {
  const complete = candidates.find(isCompleteIdentityResult);
  if (complete) return complete;
  return (
    candidates.find((item) => isValidTaiwanNationalId(item?.nationalId)) ??
    candidates.find((item) => item?.name) ??
    null
  );
}

export function identityCropCandidates(width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return [
    { key: "top", x: 0, y: 0, width: w, height: Math.round(h * 0.58) },
    {
      key: "bottom",
      x: 0,
      y: Math.round(h * 0.42),
      width: w,
      height: Math.round(h * 0.58),
    },
    { key: "left", x: 0, y: 0, width: Math.round(w * 0.62), height: h },
    {
      key: "right",
      x: Math.round(w * 0.38),
      y: 0,
      width: Math.round(w * 0.62),
      height: h,
    },
  ];
}
