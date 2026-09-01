const LIST_URLS = {
  公司: "https://serv.gcis.nat.gov.tw/caseSearch/list/QueryCsmmCaseList/queryCsmmCaseList.do",
  行號: "https://serv.gcis.nat.gov.tw/caseSearch/list/QueryBusmCaseList/queryBusmCaseList.do",
};

const DETAIL_PATHS = {
  公司: "/caseSearch/detail/QueryCsmmCaseDetail/queryCsmmCaseDetail.do",
  行號: "/caseSearch/detail/QueryBusmCaseDetail/queryBusmCaseDetail.do",
};

export class OfficialQueryError extends Error {
  constructor(message, { status = 502, code = "UPSTREAM_ERROR" } = {}) {
    super(message);
    this.name = "OfficialQueryError";
    this.status = status;
    this.code = code;
  }
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function plainText(html) {
  return decodeEntities(String(html ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|th|td|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\t\r ]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim();
}

function normalizeText(value) {
  return plainText(value).replace(/\s+/g, " ").trim();
}

function parseAttributes(source) {
  const attributes = {};
  const input = String(source ?? "");
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = pattern.exec(input))) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function extractForms(html) {
  const forms = [];
  const pattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let match;
  while ((match = pattern.exec(html))) forms.push({ attributes: parseAttributes(match[1]), body: match[2], index: match.index });
  return forms;
}

function extractInputs(formBody) {
  const inputs = [];
  const pattern = /<input\b([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(formBody))) {
    inputs.push({ attributes: parseAttributes(match[1]), index: match.index, tag: match[0] });
  }
  return inputs;
}

function extractSelects(formBody) {
  const selects = [];
  const pattern = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  let match;
  while ((match = pattern.exec(formBody))) {
    const options = [];
    const optionPattern = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
    let option;
    while ((option = optionPattern.exec(match[2]))) {
      const attributes = parseAttributes(option[1]);
      options.push({ attributes, label: normalizeText(option[2]), value: attributes.value ?? normalizeText(option[2]) });
    }
    selects.push({ attributes: parseAttributes(match[1]), options, index: match.index });
  }
  return selects;
}

function contextBefore(source, index, length = 260) {
  return normalizeText(source.slice(Math.max(0, index - length), index));
}

function inputSearchText(input, formBody) {
  const attributes = input.attributes;
  return [attributes.name, attributes.id, attributes.title, attributes.placeholder, attributes["aria-label"], attributes.alt,
    contextBefore(formBody, input.index)].filter(Boolean).join(" ").toLowerCase();
}

function chooseTaxIdInput(inputs, formBody, entityType) {
  const visible = inputs.filter(({ attributes }) => {
    const type = String(attributes.type || "text").toLowerCase();
    return attributes.name && !["hidden", "submit", "button", "reset", "image", "checkbox", "radio", "file"].includes(type);
  });
  let best = null;
  for (const input of visible) {
    const text = inputSearchText(input, formBody);
    let score = 0;
    if (/統一編號|unified\s*business|business\s*(?:id|no)/i.test(text)) score += 12;
    if (entityType === "行號" && /商業統一編號|busm.*(?:id|no)|(?:ban|br)no/i.test(text)) score += 8;
    if (entityType === "公司" && /申請人公司統一編號|cmpy.*(?:id|no)|company.*(?:id|no)/i.test(text)) score += 8;
    if (/tax.*(?:id|no)/i.test(text)) score += 5;
    if (/收文|receive|rcv|預查|reserve|pre.?check|名稱|name/.test(text)) score -= 8;
    if (!best || score > best.score) best = { input, score };
  }
  if (best?.score > 0) return best.input;
  if (entityType === "行號" && visible.length) return visible.at(-1);
  if (entityType === "公司" && visible.length >= 3) return visible[2];
  return null;
}

function selectValue(select, formBody, authority) {
  const searchText = [select.attributes.name, select.attributes.id, select.attributes.title,
    select.attributes["aria-label"], contextBefore(formBody, select.index)].filter(Boolean).join(" ");
  const isAuthority = /機關|agency|authority|reg(?:istration)?\s*unit/i.test(searchText);
  if (isAuthority) {
    // 地址變更可能同時是跨縣市遷入。用統編查詢時先查全部機關，
    // 否則舊登記資料中的機關會把新受理機關的案件排除掉。
    const allAuthorities = select.options.find((option) =>
      /全部機關|all\s*(?:agencies|authorities)/i.test(option.label)
      || /^(?:allbf|00)$/i.test(option.value));
    if (allAuthorities) return allAuthorities.value;
  }
  if (isAuthority && authority) {
    const normalizedAuthority = normalizeText(authority).replace(/[臺台]/g, "台");
    const matched = select.options.find((option) => {
      const label = option.label.replace(/[臺台]/g, "台");
      return label.includes(normalizedAuthority) || normalizedAuthority.includes(label.replace(/登記機關|政府/g, ""));
    });
    if (matched) return matched.value;
  }
  return select.options.find((option) => Object.hasOwn(option.attributes, "selected"))?.value
    ?? select.options[0]?.value ?? "";
}

function buildFormSubmission(html, pageUrl, { entityType, taxId, authority }) {
  const forms = extractForms(html);
  const form = forms.find((candidate) => /統一編號|unified business/i.test(normalizeText(candidate.body)))
    || forms.find((candidate) => /query|查詢/i.test(normalizeText(candidate.body)))
    || forms[0];
  if (!form) throw new OfficialQueryError("官方查詢頁沒有可使用的查詢表單", { code: "LAYOUT_CHANGED" });

  const inputs = extractInputs(form.body);
  const taxInput = chooseTaxIdInput(inputs, form.body, entityType);
  if (!taxInput?.attributes?.name) {
    throw new OfficialQueryError("官方查詢頁的統編欄位已變更，暫時無法由系統查詢", { code: "LAYOUT_CHANGED" });
  }

  const fields = [];
  let submitAdded = false;
  for (const input of inputs) {
    const attributes = input.attributes;
    if (!attributes.name || Object.hasOwn(attributes, "disabled")) continue;
    const type = String(attributes.type || "text").toLowerCase();
    if (["reset", "file"].includes(type)) continue;
    if (["checkbox", "radio"].includes(type) && !Object.hasOwn(attributes, "checked")) continue;
    if (["submit", "button", "image"].includes(type)) {
      const description = [attributes.value, attributes.title, attributes.alt].filter(Boolean).join(" ");
      if (!submitAdded && (/查詢|search|query/i.test(description) || type === "submit")) {
        fields.push([attributes.name, attributes.value || "查詢"]);
        submitAdded = true;
      }
      continue;
    }
    fields.push([attributes.name, input === taxInput ? taxId : (attributes.value || "")]);
  }

  for (const select of extractSelects(form.body)) {
    if (!select.attributes.name || Object.hasOwn(select.attributes, "disabled")) continue;
    fields.push([select.attributes.name, selectValue(select, form.body, authority)]);
  }

  const buttonPattern = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let button;
  while (!submitAdded && (button = buttonPattern.exec(form.body))) {
    const attributes = parseAttributes(button[1]);
    // 官方頁面的「執行查詢」是 type=button，再由 JS 呼叫 form.submit()。
    // 這種按鈕不會成為表單欄位；送出 uSend 反而可能讓後端拒絕查詢。
    if (!attributes.name || String(attributes.type || "submit").toLowerCase() !== "submit") continue;
    if (/查詢|search|query/i.test(`${normalizeText(button[2])} ${attributes.value || ""}`)) {
      fields.push([attributes.name, attributes.value || normalizeText(button[2])]);
      submitAdded = true;
    }
  }

  const method = String(form.attributes.method || "get").toUpperCase();
  const action = new URL(form.attributes.action || pageUrl, pageUrl).toString();
  return { action, method, fields, taxFieldName: taxInput.attributes.name };
}

function responseEncoding(response, bytes) {
  const contentType = response.headers.get("content-type") || "";
  const headerCharset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1];
  if (headerCharset) return headerCharset;
  const prefix = Buffer.from(bytes).subarray(0, 4096).toString("ascii");
  return prefix.match(/charset\s*=\s*["']?([^;"'\s/>]+)/i)?.[1] || "utf-8";
}

async function responseText(response) {
  const bytes = await response.arrayBuffer();
  try { return new TextDecoder(responseEncoding(response, bytes)).decode(bytes); }
  catch { return new TextDecoder("utf-8").decode(bytes); }
}

function createRequester(fetchImpl) {
  const cookies = new Map();
  const saveCookies = (headers) => {
    const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie()
      : (headers.get("set-cookie") || "").split(/,(?=\s*[^;,\s]+=)/).filter(Boolean);
    for (const value of values) {
      const pair = value.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  };

  return async function request(url, options = {}) {
    let currentUrl = new URL(url).toString();
    let method = String(options.method || "GET").toUpperCase();
    let body = options.body;
    for (let redirects = 0; redirects < 6; redirects += 1) {
      const headers = {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.6",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
        ...(options.headers || {}),
      };
      if (cookies.size) headers.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      let response;
      try {
        response = await fetchImpl(currentUrl, { method, body, headers, redirect: "manual", signal: AbortSignal.timeout(18_000) });
      } catch (error) {
        if (error instanceof OfficialQueryError) throw error;
        throw new OfficialQueryError("目前無法連線到商工案件進度網站，請稍後再按一次", { code: "NETWORK_ERROR" });
      }
      saveCookies(response.headers);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new OfficialQueryError("官方網站重新導向失敗", { code: "UPSTREAM_ERROR" });
        currentUrl = new URL(location, currentUrl).toString();
        if ([301, 302, 303].includes(response.status) && method !== "GET") { method = "GET"; body = undefined; }
        continue;
      }
      if (!response.ok) throw new OfficialQueryError(`官方網站暫時無法查詢（HTTP ${response.status}）`, { code: "UPSTREAM_ERROR" });
      return { html: await responseText(response), url: response.url || currentUrl, status: response.status };
    }
    throw new OfficialQueryError("官方網站重新導向次數過多", { code: "UPSTREAM_ERROR" });
  };
}

function extractRows(html) {
  const rows = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowPattern.exec(html))) {
    const cells = [];
    const cellPattern = /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
    let cell;
    while ((cell = cellPattern.exec(row[1]))) cells.push(normalizeText(cell[1]));
    if (cells.length) rows.push({ cells, html: row[0], index: row.index });
  }
  return rows;
}

function rowPairs(rows) {
  const pairs = [];
  for (const row of rows) {
    for (let index = 0; index < row.cells.length - 1; index += 2) {
      if (row.cells[index]) pairs.push([row.cells[index].replace(/[：:]$/, "").trim(), row.cells[index + 1].trim()]);
    }
  }
  return pairs;
}

function pickField(pairs, pattern) {
  return pairs.find(([label, value]) => pattern.test(label) && value)?.[1] || "";
}

export function mapOfficialStatus(officialStatus) {
  const value = normalizeText(officialStatus);
  if (/可自領/.test(value)) return "可自領";
  if (/已郵寄|郵寄/.test(value)) return "郵寄";
  if (/電子送達/.test(value)) return "電子送達";
  if (/補正|補件/.test(value)) return "補件";
  if (/打字/.test(value)) return "打字中";
  if (/校對/.test(value)) return "校對中";
  if (/審查/.test(value)) return "審查中";
  if (/發文中/.test(value)) return "核准發文中";
  if (/核准/.test(value)) return "核准";
  return "已送件";
}

function detailUrlFromRaw(entityType, raw, baseUrl) {
  const decoded = decodeEntities(raw).replace(/\\\//g, "/");
  const pathMatch = decoded.match(/(?:https?:\/\/[^\s"']+|(?:\/|\.\.?\/)[^\s"']*detail\/Query[^\s"']+\.do(?:\?[^\s"']*)?)/i);
  if (pathMatch) {
    try { return new URL(pathMatch[0], baseUrl).toString(); } catch { /* try the argument form below */ }
  }

  const quoted = [...decoded.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
  if (entityType === "行號") {
    const agency = quoted.find((value) => /^\d{9}[A-Z]$/i.test(value));
    const numbers = quoted.filter((value) => /^\d{9,12}$/.test(value));
    const subCase = quoted.find((value) => /^\d{2}$/.test(value)) || "01";
    if (agency && numbers.length) {
      const url = new URL(DETAIL_PATHS.行號, baseUrl);
      url.searchParams.set("caseNo", numbers[0]);
      url.searchParams.set("agency", agency);
      url.searchParams.set("receiveNo", numbers[1] || numbers[0]);
      url.searchParams.set("subAcptNo", subCase);
      return url.toString();
    }
  } else {
    const receipt = quoted.find((value) => /^\d{9,12}$/.test(value));
    const regUnitCode = quoted.find((value) => /^\d{1,4}$/.test(value));
    if (receipt) {
      const url = new URL(DETAIL_PATHS.公司, baseUrl);
      url.searchParams.set("rcvNo", receipt);
      url.searchParams.set("regUnitCode", regUnitCode || "17");
      url.searchParams.set("showPreRegNo", "0");
      return url.toString();
    }
  }
  return "";
}

function resultDetailCandidates(html, baseUrl, entityType, taxId, companyName) {
  const candidates = [];
  const pattern = /<(?:a|button)\b([^>]*)>([\s\S]*?)<\/(?:a|button)>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const attributes = parseAttributes(match[1]);
    const raw = [attributes.href, attributes.onclick, attributes["data-href"], match[1]].filter(Boolean).join(" ");
    const url = detailUrlFromRaw(entityType, raw, baseUrl);
    if (!url) continue;
    const context = normalizeText(html.slice(Math.max(0, match.index - 900), match.index + match[0].length + 900));
    let score = 1;
    if (taxId && context.includes(taxId)) score += 12;
    if (companyName && context.includes(companyName)) score += 8;
    candidates.push({ url, context, score });
  }

  if (!candidates.length) {
    for (const row of extractRows(html)) {
      const context = row.cells.join(" ");
      if (taxId && !context.includes(taxId) && companyName && !context.includes(companyName)) continue;
      const url = detailUrlFromRaw(entityType, row.html, baseUrl);
      if (url) candidates.push({ url, context, score: 5 });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

function parseOfficialDetail(html, detailUrl, entityType, fallbackContext = "") {
  const rows = extractRows(html);
  const pairs = rowPairs(rows);
  const url = new URL(detailUrl);
  // 公司案件頁面的正式欄位是「處理進度(註)」。不可退回掃描整張 HTML，
  // 因為空白欄位「正本電子送達日期」也含有「電子送達」，會把可自領誤判成電子送達。
  const officialStatus = pickField(pairs, /^(?:目前.*辦理(?:情形)?|辦理情形|處理情形|處理進度(?:\s*[（(]註[）)])?|目前進度|案件狀態)$/);
  const receiptNo = pickField(pairs, /^收文號|收件文號/)
    || url.searchParams.get("receiveNo") || url.searchParams.get("rcvNo") || url.searchParams.get("caseNo") || "";
  const companyName = pickField(pairs, /商業名稱|公司名稱|申請人公司名稱/) || "";
  const authority = pickField(pairs, /申登機關|登記機關|受理機關/) || "";
  const receivedDate = pickField(pairs, /收文日期|收件日期|收件時間/) || "";
  const outgoingNo = pickField(pairs, /發文文號/) || "";
  const outgoingDate = pickField(pairs, /發文日期/) || "";
  const subject = pickField(pairs, /^主旨/) || "";
  if (!officialStatus) {
    throw new OfficialQueryError("已找到案件，但官方頁面的進度欄位格式已變更，暫時無法帶入", { code: "LAYOUT_CHANGED" });
  }
  return {
    entityType,
    receiptNo: normalizeText(receiptNo).replace(/[^\dA-Za-z-]/g, ""),
    companyName: normalizeText(companyName) || normalizeText(fallbackContext),
    authority: normalizeText(authority),
    receivedDate: normalizeText(receivedDate),
    officialStatus: normalizeText(officialStatus),
    appStatus: mapOfficialStatus(officialStatus),
    outgoingNo: normalizeText(outgoingNo),
    outgoingDate: normalizeText(outgoingDate),
    subject: normalizeText(subject),
    progressUrl: detailUrl,
    agencyCode: url.searchParams.get("agency") || "",
    regUnitCode: url.searchParams.get("regUnitCode") || "",
    subCaseNo: url.searchParams.get("subAcptNo") || "",
  };
}

function officialDateRank(value) {
  const match = normalizeText(value).match(/^(\d{2,3})(?:年|[/.\-])(\d{1,2})(?:月|[/.\-])(\d{1,2})/);
  if (!match) return 0;
  return (Number(match[1]) + 1911) * 10_000 + Number(match[2]) * 100 + Number(match[3]);
}

export async function queryOfficialCases({ entityType, taxId, companyName = "", authority = "" }, { fetchImpl = fetch } = {}) {
  if (!LIST_URLS[entityType]) throw new OfficialQueryError("案件類別必須是公司或行號", { status: 400, code: "INVALID_ENTITY" });
  if (!/^\d{8}$/.test(String(taxId || ""))) {
    throw new OfficialQueryError("這筆案件沒有 8 碼統編；新設立案件請先用收文號登記", { status: 400, code: "MISSING_TAX_ID" });
  }

  const request = createRequester(fetchImpl);
  const listPage = await request(LIST_URLS[entityType]);
  const submission = buildFormSubmission(listPage.html, listPage.url, { entityType, taxId, authority });
  const params = new URLSearchParams();
  submission.fields.forEach(([name, value]) => params.append(name, value));
  let resultUrl = submission.action;
  const options = { method: submission.method, headers: { Referer: listPage.url } };
  if (submission.method === "GET") {
    const url = new URL(submission.action);
    for (const [name, value] of params) url.searchParams.append(name, value);
    resultUrl = url.toString();
  } else {
    options.body = params.toString();
    options.headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const resultPage = await request(resultUrl, options);
  const candidates = resultDetailCandidates(resultPage.html, resultPage.url, entityType, taxId, companyName);
  if (!candidates.length) {
    const text = normalizeText(resultPage.html);
    const limit = entityType === "行號" ? "90 天" : "180 天";
    if (/查無|無符合|沒有符合|查不到|no records?/i.test(text)) {
      throw new OfficialQueryError(`官方網站查不到這筆案件；${entityType}案件僅提供近 ${limit} 的進度`, { status: 404, code: "NOT_FOUND" });
    }
    throw new OfficialQueryError(`官方網站尚未出現這筆案件，或查詢條件不足；請確認統編與「${entityType}」類別後稍後再查`, { status: 404, code: "NOT_FOUND" });
  }

  const results = [];
  const seen = new Set();
  let firstDetailError = null;
  for (const candidate of candidates) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    try {
      const detailPage = await request(candidate.url, { headers: { Referer: resultPage.url } });
      results.push(parseOfficialDetail(detailPage.html, detailPage.url || candidate.url, entityType, candidate.context));
    } catch (error) {
      firstDetailError ||= error;
    }
  }
  if (!results.length) {
    if (firstDetailError instanceof OfficialQueryError) throw firstDetailError;
    throw new OfficialQueryError("已找到案件，但官方明細目前無法讀取", { code: "LAYOUT_CHANGED" });
  }
  return results.sort((a, b) => officialDateRank(b.receivedDate) - officialDateRank(a.receivedDate)
    || String(b.receiptNo).localeCompare(String(a.receiptNo), "zh-Hant"));
}

export async function queryOfficialCase(input, dependencies = {}) {
  const results = await queryOfficialCases(input, dependencies);
  const receiptNo = normalizeText(input?.receiptNo || "").replace(/[^\dA-Za-z-]/g, "");
  if (receiptNo) {
    const matched = results.find((item) => item.receiptNo === receiptNo);
    if (!matched) throw new OfficialQueryError("官方查詢結果中找不到指定的收文號", { status: 404, code: "NOT_FOUND" });
    return matched;
  }
  return results[0];
}

export const officialListUrls = Object.freeze({ ...LIST_URLS });
