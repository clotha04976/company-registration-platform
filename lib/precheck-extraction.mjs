const toAscii = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\r/g, "\n");

const compactDigits = (value) =>
  toAscii(value).replace(/[^0-9]/g, "");

export function normalizePrecheckNumber(value) {
  return compactDigits(value);
}

export function isValidPrecheckNumber(value) {
  const normalized = normalizePrecheckNumber(value);
  if (!/^\d{9}$/.test(normalized)) return false;
  const rocYear = Number(normalized.slice(0, 3));
  const serial = normalized.slice(3);
  return rocYear >= 80 && rocYear <= 199 && serial !== "000000";
}

const isValidDate = (year, month, day) => {
  if (year < 1912 || year > 2110 || month < 1 || month > 12 || day < 1)
    return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

export function normalizeRocDate(value) {
  let normalized = toAscii(value)
    .replace(/[\s　]+/g, "")
    .replace(/^中華民國/, "")
    .replace(/^民國/, "")
    .replace(/[年月.\-]/g, "/")
    .replace(/日$/, "")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (/^\d{7}$/.test(normalized))
    normalized = `${normalized.slice(0, 3)}/${normalized.slice(3, 5)}/${normalized.slice(5)}`;
  else if (/^\d{8}$/.test(normalized))
    normalized = `${normalized.slice(0, 4)}/${normalized.slice(4, 6)}/${normalized.slice(6)}`;
  const match = normalized.match(/^(\d{2,4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return "";
  const inputYear = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const westernYear = inputYear >= 1912 ? inputYear : inputYear + 1911;
  const rocYear = westernYear - 1911;
  if (rocYear < 1 || rocYear > 199 || !isValidDate(westernYear, month, day))
    return "";
  return `${String(rocYear).padStart(3, "0")}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

const PRECHECK_LABEL =
  /(?:公司\s*名稱\s*)?預\s*查\s*(?:核\s*定\s*)?(?:編\s*號|案\s*號|號\s*碼)/;

const DATE_FRAGMENT =
  /(?:中\s*華\s*民\s*國\s*|民\s*國\s*)?(?:(?:\d[\s　]*){2,4}\s*(?:年|[/.\-])\s*(?:\d[\s　]*){1,2}\s*(?:月|[/.\-])\s*(?:\d[\s　]*){1,2}\s*日?|(?:\d[\s　]*){7,8})/;

const extractLabeledValue = (lines, labelPattern, extractor) => {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const label = line.match(labelPattern);
    if (!label) continue;
    const sameLine = line.slice((label.index ?? 0) + label[0].length);
    const fromSameLine = extractor(sameLine);
    if (fromSameLine) return fromSameLine;
    const fromNextLine = extractor(lines[index + 1] ?? "");
    if (fromNextLine) return fromNextLine;
  }
  return "";
};

const extractLabeledTextValue = (text, labelPattern, extractor) => {
  const flags = labelPattern.flags.includes("g")
    ? labelPattern.flags
    : `${labelPattern.flags}g`;
  const globalPattern = new RegExp(labelPattern.source, flags);
  for (const match of text.matchAll(globalPattern)) {
    const start = (match.index ?? 0) + match[0].length;
    const value = extractor(text.slice(start, start + 120));
    if (value) return value;
  }
  return "";
};

const extractPrecheckNumber = (lines) =>
  extractLabeledValue(lines, PRECHECK_LABEL, (value) => {
    const candidate = value.match(/(?:\d[\s　.\-/]*){9}/)?.[0] ?? "";
    const normalized = normalizePrecheckNumber(candidate);
    return isValidPrecheckNumber(normalized) ? normalized : "";
  });

const extractDateByLabel = (lines, labelPattern) =>
  extractLabeledValue(lines, labelPattern, (value) => {
    const candidate = value.match(DATE_FRAGMENT)?.[0] ?? "";
    return normalizeRocDate(candidate);
  });

const COMPANY_SUFFIX = "(?:股份)?有限公司";
const COMPANY_LABEL =
  /(?:核\s*准\s*(?:之\s*)?|預\s*查\s*)?公\s*司\s*名\s*稱/;

const extractCompanyName = (lines) =>
  extractLabeledValue(lines, COMPANY_LABEL, (value) => {
    const cleaned = toAscii(value)
      .replace(/^[\s:：;；,，.。\-_=]+/, "")
      .replace(/[\s　]+/g, "");
    const match = cleaned.match(
      new RegExp(`^([\\u3400-\\u9fffA-Za-z0-9（）()·]{2,40}${COMPANY_SUFFIX})`),
    );
    if (!match) return "";
    const companyName = match[1];
    if (/預查核定書|申請書|登記表/.test(companyName)) return "";
    return companyName;
  });

const BUSINESS_CODE = /\b([A-Z]{1,2}[\s.\-]*(?:\d[\s.\-]*){5,6})\b/g;

const normalizeBusinessCode = (value) =>
  toAscii(value).toUpperCase().replace(/[^A-Z0-9]/g, "");

const extractBusinessName = (value) => {
  const beforeNextCode = toAscii(value).split(/\b[A-Z]{1,2}[\s.\-]*(?:\d[\s.\-]*){5,6}\b/)[0];
  const cleaned = beforeNextCode
    .replace(/^[\s:：;；,，、.。\-_=()（）\d]+/, "")
    .replace(/[\s　]+/g, "")
    .replace(/,/g, "，");
  const match = cleaned.match(/^([\u3400-\u9fff，、（）()]{1,59}業務?)/);
  return match?.[1] ?? "";
};

const extractBusinessItems = (lines) => {
  const items = [];
  const seen = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = toAscii(lines[index]).toUpperCase();
    BUSINESS_CODE.lastIndex = 0;
    for (const match of line.matchAll(BUSINESS_CODE)) {
      const code = normalizeBusinessCode(match[1]);
      if (!/^(?:[A-Z]\d{6}|[A-Z]{2}\d{5})$/.test(code)) continue;
      const remainder = line.slice((match.index ?? 0) + match[0].length);
      const name =
        extractBusinessName(remainder) || extractBusinessName(lines[index + 1] ?? "");
      if (!name || seen.has(code)) continue;
      seen.add(code);
      items.push({ code, name });
    }
  }
  return items;
};

export function parsePrecheckText(pagesOrText) {
  const text = Array.isArray(pagesOrText)
    ? pagesOrText.map((page) => String(page?.text ?? "")).join("\n")
    : String(pagesOrText ?? "");
  const lines = toAscii(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const numberFromText = () =>
    extractLabeledTextValue(text, PRECHECK_LABEL, (value) => {
      const candidate = value.match(/(?:\d[\s　.\-/]*){9}/)?.[0] ?? "";
      const normalized = normalizePrecheckNumber(candidate);
      return isValidPrecheckNumber(normalized) ? normalized : "";
    });
  const dateFromText = (labelPattern) =>
    extractLabeledTextValue(text, labelPattern, (value) =>
      normalizeRocDate(value.match(DATE_FRAGMENT)?.[0] ?? ""),
    );
  const companyFromText = () =>
    extractLabeledTextValue(text, COMPANY_LABEL, (value) => {
      const cleaned = toAscii(value)
        .replace(/^[\s:：;；,，.。\-_=]+/, "")
        .replace(/[\s　]+/g, "");
      const match = cleaned.match(
        new RegExp(`^([\\u3400-\\u9fffA-Za-z0-9（）()·]{2,40}${COMPANY_SUFFIX})`),
      );
      return match?.[1] ?? "";
    });
  return {
    precheckNumber: extractPrecheckNumber(lines) || numberFromText(),
    approvalDate:
      extractDateByLabel(
        lines,
        /(?:核\s*准|核\s*定|發\s*文)\s*日\s*期/,
      ) ||
      dateFromText(/(?:核\s*准|核\s*定|發\s*文)\s*日\s*期/),
    expiryDate:
      extractDateByLabel(
        lines,
        /(?:核\s*准\s*)?(?:名\s*稱\s*)?保\s*留\s*(?:期\s*限|至)/,
      ) ||
      dateFromText(
        /(?:核\s*准\s*)?(?:名\s*稱\s*)?保\s*留\s*(?:期\s*限|至)/,
      ),
    companyName: extractCompanyName(lines) || companyFromText(),
    businessItems: extractBusinessItems(lines),
  };
}
