import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import {
  buildDocx,
  buildRegistrationFormDocx,
  buildZip,
} from "../lib/ooxml.mjs";
import {
  collectPageTexts,
  detectIncludedDocuments,
  extractAddressCandidates,
  formatPageRange,
  parsePageRange,
  shouldRunPdfOcr,
  splitPdfPages,
} from "../lib/document-extraction.mjs";
import {
  isValidTaiwanNationalId,
  identityCropCandidates,
  mergeIdentityFields,
  parseTaiwanIdentityText,
  selectIdentityResult,
  selectRotationCandidate,
} from "../lib/identity-extraction.mjs";
import { PDFDocument } from "pdf-lib";

test("Taiwan national ID validation uses official checksum", () => {
  assert.equal(isValidTaiwanNationalId("A123456789"), true);
  assert.equal(isValidTaiwanNationalId("A 1 2 8 0 8 2 7 3 4"), true);
  assert.equal(isValidTaiwanNationalId("A123456788"), false);
  assert.equal(isValidTaiwanNationalId("A323456789"), false);
  assert.equal(isValidTaiwanNationalId("Z123456789"), false);
});

test("identity enhancement selects the first complete rotation and uses 2x crop regions", () => {
  const validId = ["A", "123", "456", "789"].join("");
  const selected = selectRotationCandidate([
    { rotation: 0, name: "", nationalId: "" },
    { rotation: 90, name: "測試人", nationalId: validId },
    { rotation: 180, name: "另一人", nationalId: validId },
  ]);
  assert.equal(selected?.rotation, 90);
  const crops = identityCropCandidates(1000, 1600);
  assert.deepEqual(crops.map((item) => item.key), ["top", "bottom", "left", "right"]);
  assert.ok(crops.every((item) => item.width > 0 && item.height > 0));
});

test("PDF OCR purpose preserves good precheck text but keeps address fallback", () => {
  assert.equal(shouldRunPdfOcr(1157, false, "precheck"), false);
  assert.equal(shouldRunPdfOcr(1157, false, "address"), true);
  assert.equal(shouldRunPdfOcr(20, true, "precheck"), true);
});

test("identity parser conservatively reads a labeled Chinese name and spaced ID", () => {
  assert.deepEqual(
    parseTaiwanIdentityText([
      {
        text: "中華民國國民身分證\n姓 名：林 彥 丞\n國籍 中華民國\n身分證字號 A 1 2 3 4 5 6 7 8 9\n出生日期 民國80年",
      },
    ]),
    { name: "林彥丞", nationalId: "A123456789" },
  );
  assert.deepEqual(
    parseTaiwanIdentityText("姓名\n黃 郁 庭\n戶籍地址：台北市中正區\nA123456788"),
    { name: "黃郁庭", nationalId: "" },
  );
  assert.equal(
    parseTaiwanIdentityText("戶籍地址：姓名路一段\n國籍：中華民國\n出生日期：80年").name,
    "",
  );
});

test("identity selection waits for all files then uses the first complete file", () => {
  const first = { sourceFile: "正面-1.jpg", name: "林彥丞", nationalId: "A123456789" };
  const second = { sourceFile: "正面-2.jpg", name: "黃郁庭", nationalId: "A123456789" };
  assert.deepEqual(selectIdentityResult(["one", "two"], { two: second }), {
    state: "processing",
  });
  assert.deepEqual(
    selectIdentityResult(["one", "two"], { one: first, two: second }),
    {
      state: "success",
      ...first,
      birthDate: "",
      address: "",
      contactPostalCode: "",
      nationalIdSource: "",
    },
  );
});

test("identity selection merges front fields with back address and barcode fallback", () => {
  assert.deepEqual(
    selectIdentityResult(
      ["front", "back"],
      {
        front: {
          sourceFile: "front.jpg",
          name: "林彥丞",
          nationalId: "A123456789",
          birthDate: "080/05/06",
        },
        back: {
          sourceFile: "back.jpg",
          name: "",
          nationalId: "A123456789",
          nationalIdSource: "barcode",
          address: "臺北市中正區測試路一段12號",
        },
      },
    ),
    {
      state: "success",
      sourceFile: "front.jpg",
      name: "林彥丞",
      nationalId: "A123456789",
      birthDate: "080/05/06",
      address: "臺北市中正區測試路一段12號",
      contactPostalCode: "",
      nationalIdSource: "",
    },
  );
});

test("identity merge never overwrites manually edited fields", () => {
  const current = { representative: "手動姓名", nationalId: "A123456789", company: "鼎泰結構有限公司" };
  assert.deepEqual(
    mergeIdentityFields(
      current,
      { name: "林彥丞", nationalId: "A123456789" },
      { representative: true, nationalId: true },
    ),
    current,
  );
  assert.deepEqual(
    mergeIdentityFields(
      { ...current, representative: "" },
      { name: "林彥丞", nationalId: "A123456788" },
      { representative: false, nationalId: false },
    ),
    { ...current, representative: "林彥丞" },
  );
});

test("identity OCR is triggered only from the identity upload slot", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(key === "identity"\)[\s\S]+processIdentityFile/);
  assert.match(page, /runIdentityService/);
  assert.doesNotMatch(page, /瀏覽器備援 OCR/);
  assert.match(page, /無法連線本機 OCR 服務/);
  const addressProcessor = page.slice(
    page.indexOf("const processAddressFile"),
    page.indexOf("const applyIdentitySelection"),
  );
  assert.doesNotMatch(addressProcessor, /parseTaiwanIdentityText|nationalId|representative/);
  for (const message of [
    "身分證辨識中",
    "身分證辨識完成後才能繼續",
    "請至下一步確認",
    "未辨識到有效的姓名與身分證字號",
    "已採用",
  ])
    assert.match(page, new RegExp(message));
  assert.match(
    page,
    /processingAddress\s*\|\|\s*identityRecognition\.state === "processing"/,
  );
  assert.match(
    page,
    /\["identity", "name_reservation"\]\.includes\(slot\.key\)[\s\S]{0,100}"\.pdf,\.jpg,\.jpeg,\.png"/,
  );
  for (const label of ["身分證正面", "身分證反面", "正反面合併掃描／A4"])
    assert.match(page, new RegExp(label));
  assert.match(page, /runIdentityService\([\s\S]+identityFileSides\.current/);
  assert.match(page, /證號來自反面條碼/);
  assert.match(page, /lookupTaiwanPostalCode\(serviceResult\.address\)/);
  assert.match(page, /建議確認地址正確後，手動刪除「里、鄰」資料/);
  assert.match(page, /zip5\.5432\.tw/);
  assert.match(
    page,
    /const incomingIds = new Set\(next\.map\(fileId\)\)[\s\S]+for \(const id of incomingIds\) delete refreshed\[id\][\s\S]+for \(const file of next\) void processIdentityFile/,
  );
});

test("wizard navigation lives in consistent step footers and supports mobile", async () => {
  const [page, approval, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/approval-tracking.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const beforeHeader = page.slice(page.indexOf("return ("), page.indexOf("<header className=\"hero\">"));
  assert.doesNotMatch(beforeHeader, /back-dashboard|返回案件清單/);
  assert.match(
    page,
    /stage-actions-left[\s\S]+setView\("dashboard"\)[\s\S]+返回案件清單[\s\S]+stage-actions-right[\s\S]+setStep\(2\)[\s\S]+下一步：確認資料/,
  );
  assert.match(
    page,
    /setStep\(1\)[\s\S]+上一步[\s\S]+setStep\(3\)[\s\S]+下一步：下載文件/,
  );
  assert.match(
    page,
    /setStep\(2\)[\s\S]+上一步[\s\S]+setStep\(4\)[\s\S]+下一步：前往核准追蹤/,
  );
  assert.match(page, /onBack=\{\(\) => setStep\(3\)\}/);
  assert.match(page, /onExit=\{\(\) => setView\("dashboard"\)\}/);
  assert.match(approval, /onExit: \(\) => void/);
  assert.match(approval, /onClick=\{onBack\}[\s\S]+上一步/);
  assert.match(approval, /onClick=\{onExit\}[\s\S]+返回案件清單/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]+\.stage-actions\.stage-actions>div\{display:flex;flex-direction:column;width:100%\}/);
  assert.match(css, /\.stage-actions\.stage-actions button\{width:100%\}/);
});

test("precheck OCR is slot-isolated, protects manual fields, and sends metadata only", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(key === "name_reservation"\)[\s\S]+processPrecheckFile/);
  assert.match(page, /\{ purpose: "precheck" \}/);
  assert.match(page, /precheckManual\.current\[key\] = true/);
  assert.match(page, /precheckManual\.current\.business = true/);
  assert.match(page, /action: "advance_after_precheck"/);
  assert.match(page, /首頁進度已更新/);
  assert.match(page, /precheckRecognition\.state === "processing"/);
  const precheckProcessor = page.slice(
    page.indexOf("const processPrecheckFile"),
    page.indexOf("const addFiles"),
  );
  assert.match(precheckProcessor, /JSON\.stringify\(\{ action: "advance_after_precheck" \}\)/);
  assert.doesNotMatch(precheckProcessor, /arrayBuffer|base64|FormData|body:\s*file/);
  const addressProcessor = page.slice(
    page.indexOf("const processAddressFile"),
    page.indexOf("const applyIdentitySelection"),
  );
  assert.doesNotMatch(addressProcessor, /parsePrecheckText|precheckManual/);
});

test("buildDocx creates a valid OOXML OPC package", () => {
  const bytes = buildDocx("股東同意書", [
    "茲同意設立範例工程有限公司。",
    "日期：　　年　　月　　日",
  ]);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  const parts = unzipSync(bytes);
  for (const name of [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/styles.xml",
    "word/_rels/document.xml.rels",
    "docProps/core.xml",
    "docProps/app.xml",
  ])
    assert.ok(parts[name], `missing ${name}`);
  assert.match(
    strFromU8(parts["_rels/.rels"]),
    /officeDocument[^>]+Target="word\/document.xml"/,
  );
  assert.match(
    strFromU8(parts["[Content_Types].xml"]),
    /wordprocessingml\.document\.main\+xml/,
  );
  assert.match(
    strFromU8(parts["word/_rels/document.xml.rels"]),
    /relationships\/styles[^>]+Target="styles.xml"/,
  );
  assert.match(strFromU8(parts["word/document.xml"]), /範例工程有限公司/);
});

test("batch ZIP preserves same-name files with unique names", () => {
  const bytes = buildZip([
    { name: "附件.pdf", data: new Uint8Array([1]) },
    { name: "附件.pdf", data: new Uint8Array([2]) },
  ]);
  const files = unzipSync(bytes);
  assert.deepEqual(Object.keys(files).sort(), ["附件.pdf", "附件_2.pdf"]);
});

test("Step 1 follows the real staged intake workflow", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  for (const text of [
    "名稱預查階段",
    "名稱核准後・市政府設立階段",
    "籌備處存摺",
    "租約／地址相關文件整包",
    "公司所在地（可稍後補）",
    "確認包含",
  ])
    assert.match(page, new RegExp(text));
  assert.match(
    page,
    /key:\s*"passbook"[\s\S]{0,100}phase:\s*"名稱核准後・市政府設立階段"/,
  );
  assert.doesNotMatch(
    page,
    /land_title.*required|house_tax.*required|building_consent.*required|floor_plan.*required/,
  );
});

test("Step 3 exposes DOCX and all three batch downloads", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  for (const text of [
    "下載市政府全部文件",
    "下載國稅局全部文件",
    "下載所有可用文件",
    "待提供正式範本，不納入批次下載",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".docx",
  ])
    assert.match(page, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(page, /downloadXml|\.xml`|Word XML/);
  assert.match(page, /new Set<File>/);
});

test("case workflow supports four stages and backward-compatible completion", async () => {
  const [dashboard, schema, api, database] = await Promise.all([
    readFile(new URL("../app/cases-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/cases/[id]/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
  ]);
  for (const stage of [
    "name_precheck",
    "city_government",
    "national_tax",
    "completed",
  ]) {
    assert.match(dashboard, new RegExp(stage));
    assert.match(schema, new RegExp(stage));
  }
  for (const label of ["名稱預查", "市政府", "國稅局", "已結案"])
    assert.match(dashboard, new RegExp(label));
  assert.match(api, /action === "complete"/);
  assert.match(api, /action === "restore"/);
  assert.match(api, /stage = 'national_tax'/);
  assert.match(database, /PRAGMA table_info\(cases\)/);
  assert.match(database, /ALTER TABLE cases ADD COLUMN stage/);
});

test("dashboard keeps one editable stage control without workflow percentages", async () => {
  const [dashboard, page] = await Promise.all([
    readFile(new URL("../app/cases-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(dashboard, /className="stage-track"/);
  assert.doesNotMatch(dashboard, /className="progress"/);
  assert.match(
    dashboard,
    /目前進度[\s\S]{0,300}<select[\s\S]{0,300}value=\{item\.stage\}[\s\S]{0,900}void update\(item\.id, \{ stage \}\)/,
  );
  for (const [value, label] of [
    ["name_precheck", "名稱預查"],
    ["city_government", "市政府"],
    ["national_tax", "國稅局"],
    ["completed", "已結案"],
  ])
    assert.match(dashboard, new RegExp(`value: "${value}", label: "${label}"`));
  assert.match(page, /extractions\[fileId\(file\)\]\.progress\}%/);
  assert.match(page, /width: `\$\{extractions\[fileId\(file\)\]\.progress\}%`/);
});

test("dashboard counts all cases by created month and exposes no compensation data", async () => {
  const [dashboard, route] = await Promise.all([
    readFile(new URL("../app/cases-dashboard.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/cases/dashboard/route.ts", import.meta.url),
      "utf8",
    ),
  ]);
  for (const forbidden of [
    "獎金",
    "NT$500",
    "bonusPerCase",
    "bonusTotal",
    "bonusTwd",
  ])
    assert.doesNotMatch(dashboard, new RegExp(forbidden));
  assert.match(route, /substr\(c\.created_at, 1, 7\)/);
  assert.match(route, /substr\(cases\.created_at, 1, 7\)/);
  assert.doesNotMatch(
    route,
    /COUNT[^"\n]*completed_at|WHERE[^"\n]*completed_at|status\s*=\s*'completed'/,
  );
  assert.match(dashboard, /統計月份/);
  assert.match(dashboard, /目前使用者所選月件數/);
  assert.match(dashboard, /開案件數/);
  assert.match(dashboard, /結案月份/);
});

test("history details open as a read-only preview without changing case state", async () => {
  const dashboard = await readFile(
    new URL("../app/cases-dashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(dashboard, /selectedHistoryCase/);
  assert.match(dashboard, /唯讀預覽/);
  assert.match(dashboard, /返回歷史/);
  assert.match(
    dashboard,
    /onClick=\{\(\) => setSelectedHistoryCase\(item\)\}[\s\S]{0,80}查看資料/,
  );
  assert.doesNotMatch(
    dashboard,
    /update\([^)]*action:\s*"restore"[^)]*\)[^<]*>查看資料/,
  );
  assert.match(
    dashboard,
    /className="secondary" onClick=\{\(\) => void update\(item\.id, \{ action: "restore" \}/,
  );
});

test("selected-month employee count expands monthly cases with safe routing", async () => {
  const [dashboard, route] = await Promise.all([
    readFile(new URL("../app/cases-dashboard.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/cases/dashboard/route.ts", import.meta.url),
      "utf8",
    ),
  ]);
  for (const field of [
    "monthlyCases",
    "companyName",
    "summary",
    "employeeId",
    "employeeName",
    "stage",
    "status",
    "progress",
    "createdAt",
    "completedAt",
  ])
    assert.match(route, new RegExp(field));
  assert.match(route, /WHERE substr\(c\.created_at, 1, 7\) = \?/);
  assert.match(dashboard, /所選月份目前使用者/);
  assert.match(dashboard, /開案明細/);
  assert.match(dashboard, /openMonthlyCase/);
  assert.match(
    dashboard,
    /item\.status !== "completed"\) \{[\s\S]{0,100}onOpenWizard\(item\);[\s\S]{0,50}return;/,
  );
  assert.match(dashboard, /setShowMonthlyCases\(false\)/);
  assert.match(dashboard, /setSelectedHistoryCase\(item\)/);
  assert.match(dashboard, /history-readonly-preview/);
  assert.match(dashboard, /scrollIntoView/);
  assert.doesNotMatch(dashboard, /openMonthlyCase[\s\S]{0,180}restore/);
});

test("stale cases use a 30-day ongoing-only reminder and safe keep-active touch", async () => {
  const [dashboard, route, patchRoute] = await Promise.all([
    readFile(new URL("../app/cases-dashboard.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/cases/dashboard/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/cases/[id]/route.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(
    route,
    /status = 'ongoing' AND datetime\(updated_at\) <= datetime\(\?, '-30 days'\)/,
  );
  assert.match(
    route,
    /c\.status = 'ongoing' AND datetime\(c\.updated_at\) <= datetime\(\?, '-30 days'\)/,
  );
  assert.match(route, /staleCount/);
  assert.match(route, /staleCases/);
  assert.match(patchRoute, /body\.action === "keep_active"/);
  const keepActiveSql =
    "UPDATE cases SET updated_at = ? WHERE id = ? AND status = 'ongoing'";
  assert.match(patchRoute, new RegExp(keepActiveSql.replace(/[?]/g, "\\?")));
  const keepActiveSetClause = keepActiveSql.split(/\s+WHERE\s+/i)[0];
  assert.doesNotMatch(
    keepActiveSetClause,
    /stage\s*=|status\s*=|progress\s*=|completed_at\s*=/,
  );
  for (const copy of [
    "待確認",
    "仍在辦理",
    "案件已30天未更新，請確認進度",
    "是否已完成國稅局送件並可結案？",
    "case-stale",
    "stale-warning",
  ])
    assert.match(dashboard, new RegExp(copy));
  assert.doesNotMatch(route, /action:\s*"complete"/);
});

test("sensitive data remains fully visible in confirmation and documents", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /A123456789/);
  assert.match(page, /身分證字號（完整顯示）/);
  assert.doesNotMatch(page, /遮罩|碼掉|mask/i);
  for (const retainedContent of [
    "王小明",
    "臺北市中正區範例路1號",
    "第十六條",
    "公司大章",
    "親簽",
  ])
    assert.match(page, new RegExp(retainedContent));
  assert.doesNotMatch(page, /Vue\.js|FastAPI|SQLite/);
});

test("address parser ranks premises context above personal and communication addresses", () => {
  const candidates = extractAddressCandidates(
    [
      {
        page: 1,
        text: "出租人戶籍地址：桃園市桃園區中正路100號5樓；通訊地址同上。",
      },
      {
        page: 2,
        text: "租賃標的／房屋所在地：台中市西屯區台灣大道三段99號12樓，作為公司登記使用。",
      },
      { page: 3, text: "承租人聯絡地址：新北市板橋區文化路一段20號3樓。" },
    ],
    "地址整包.pdf",
  );
  assert.ok(candidates.length >= 2);
  assert.equal(candidates[0].address, "臺中市西屯區台灣大道三段99號12樓");
  assert.equal(candidates[0].sourceFile, "地址整包.pdf");
  assert.equal(candidates[0].page, 2);
  assert.match(candidates[0].evidence, /租賃標的|房屋所在地/);
  assert.ok(
    candidates[0].score >
      candidates.find((candidate) => candidate.address.includes("中正路"))
        ?.score,
  );
});

test("page extraction adapter can be injected without running OCR", async () => {
  const calls = [];
  const pages = await collectPageTexts(3, async (page) => {
    calls.push(page);
    return `第${page}頁文字`;
  });
  assert.deepEqual(calls, [1, 2, 3]);
  assert.deepEqual(
    pages.map((page) => page.text),
    ["第1頁文字", "第2頁文字", "第3頁文字"],
  );
});

test("client extraction uses real lazy PDF and OCR engines with truthful UI states", async () => {
  const [moduleSource, page] = await Promise.all([
    readFile(
      new URL("../lib/document-extraction.mjs", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(moduleSource, /import\("pdfjs-dist"\)/);
  assert.match(moduleSource, /import\("tesseract\.js"\)/);
  assert.match(moduleSource, /worker\.terminate\(\)/);
  assert.match(moduleSource, /目前無法自動辨識，請人工確認\/填寫/);
  assert.doesNotMatch(
    page,
    /recogniseAddressBundle|setTimeout\(\(\) => \{\s*setDetections/,
  );
  for (const text of [
    "pending",
    "extracting",
    "ocr",
    "success",
    "review",
    "error",
    "未辨識到公司所在地，請人工填寫",
    "來源：",
    "信心：",
    "證據：",
    "addressCandidates",
    "registrationAddress: top.address",
  ])
    assert.match(page, new RegExp(text));
  assert.match(
    page,
    /disabled=\{[\s\S]*processingAddress\s*\|\|\s*identityRecognition\.state === "processing"[\s\S]*\}/,
  );
  assert.match(page, /addressManual\.current = true/);
});

test("page classification merges consecutive and disjoint evidence ranges", () => {
  const detections = detectIncludedDocuments(
    [
      { page: 1, text: "房屋租賃契約 出租人 承租人 租賃標的" },
      { page: 2, text: "房屋租賃契約 出租人 承租人" },
      { page: 3, text: "土地所有權狀 地號 權利範圍" },
      { page: 5, text: "房屋租賃契約 租賃標的 出租人" },
    ],
    "整包.pdf",
  );
  const lease = detections.find((item) => item.key === "lease");
  assert.equal(lease.pageRange, "1-2,5");
  assert.equal(lease.confidence, "高");
  assert.ok(lease.score >= 70);
  assert.match(lease.evidence, /租賃契約/);
  assert.equal(formatPageRange([5, 2, 1, 2]), "1-2,5");
});

test("checklist page does not contaminate attached-document page ranges", () => {
  const pages = [];
  for (let page = 1; page <= 8; page += 1)
    pages.push({ page, text: "房屋租賃契約 出租人 承租人 租賃標的" });
  pages.push({
    page: 9,
    text: "文件簽收確認單，請逐一核對並提供以下資料：租賃契約、位置圖、建物所有權狀、房屋使用同意書、房屋稅單。出租人及承租人簽收。",
  });
  pages.push({ page: 10, text: "營業場所位置圖 比例尺 圖例" });
  pages.push({ page: 11, text: "建物所有權狀 地號 權利範圍" });
  pages.push({ page: 12, text: "房屋使用同意書 同意作為公司登記" });
  pages.push({ page: 13, text: "房屋稅繳款書 房屋稅籍 房屋稅" });
  const detections = detectIncludedDocuments(
    pages,
    "樂客 營業登記租賃合約.pdf",
  );
  const ranges = Object.fromEntries(
    detections.map((item) => [item.key, item.pageRange]),
  );
  assert.equal(ranges.lease, "1-9");
  assert.equal(ranges.floor_plan, "10");
  assert.equal(ranges.land_title, "11");
  assert.equal(ranges.building_consent, "12");
  assert.equal(ranges.house_tax, "13");
  for (const key of [
    "floor_plan",
    "land_title",
    "building_consent",
    "house_tax",
  ])
    assert.doesNotMatch(ranges[key], /(?:^|[,-])9(?:$|[,-])/);
});

test("page range validation and pdf-lib splitting are deterministic", async () => {
  assert.deepEqual(parsePageRange("1-2,5,2", 5), [1, 2, 5]);
  assert.throws(() => parsePageRange("0,2", 5), /頁碼超出/);
  assert.throws(() => parsePageRange("2-9", 5), /頁碼超出/);
  assert.throws(() => parsePageRange("x", 5), /格式/);
  const source = await PDFDocument.create();
  source.addPage();
  source.addPage();
  source.addPage();
  const split = await splitPdfPages(await source.save(), "1,3", 3);
  assert.equal((await PDFDocument.load(split)).getPageCount(), 2);
});

test("invalid manual page ranges are shown inline and preserved in batch downloads", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /parsePageRange/);
  assert.match(page, /detectionRangeError/);
  assert.match(page, /頁碼格式不正確/);
  assert.match(page, /頁碼超出文件範圍/);
  assert.match(page, /disabled=\{Boolean\(detectionRangeError\(item\)\)\}/);
  assert.match(page, /catch \{\s*originals\.add\(source\);\s*\}/);
});

test("approval tracking schema, runtime initialization, and migration stay normalized", async () => {
  const [schema, database, migration] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../drizzle/0003_steady_echo.sql", import.meta.url),
      "utf8",
    ),
  ]);
  for (const table of ["case_approval_documents", "registration_card_tracking"])
    for (const source of [schema, database, migration])
      assert.match(source, new RegExp(table));
  assert.match(
    schema,
    /uniqueIndex\("case_approval_documents_case_agency_unique"\)/,
  );
  assert.match(schema, /index\("case_approval_documents_case_status_idx"\)/);
  assert.match(
    migration,
    /FOREIGN KEY \(`case_id`\) REFERENCES `cases`\(`id`\)/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX `case_approval_documents_case_agency_unique`/,
  );
  assert.match(
    migration,
    /CREATE INDEX `case_approval_documents_case_status_idx`/,
  );
  assert.ok(
    migration.indexOf("DELETE FROM `case_approval_documents`") <
      migration.indexOf("DELETE FROM `cases`"),
  );
  assert.match(
    migration,
    /DELETE FROM `sqlite_sequence` WHERE `name` IN \('cases', 'case_approval_documents'\)/,
  );
  assert.doesNotMatch(database, /INSERT OR IGNORE INTO cases/);
  assert.match(database, /INSERT OR IGNORE INTO employees/);
});

test("case-scoped approvals API validates and upserts metadata without file bytes", async () => {
  const api = await readFile(
    new URL("../app/api/cases/[id]/approvals/route.ts", import.meta.url),
    "utf8",
  );
  for (const marker of [
    "not_received",
    "received",
    "archived",
    "city_government",
    "national_tax",
    "approvalDate",
    "documentNumber",
    "cloudPath",
    "originalReceived",
    "customerCopySent",
  ])
    assert.match(api, new RegExp(marker));
  assert.match(api, /SELECT id FROM cases WHERE id = \? LIMIT 1/);
  assert.match(api, /ON CONFLICT\(case_id, agency\) DO UPDATE/);
  assert.match(api, /ON CONFLICT\(case_id\) DO UPDATE/);
  assert.match(api, /value === ""/);
  assert.match(api, /UPDATE cases SET updated_at = \? WHERE id = \?/);
  assert.match(api, /ownKeysOnly/);
  assert.doesNotMatch(api, /base64|arrayBuffer|formData|file_bytes|blob/i);
});

test("Step 4 tracks approvals while local documents remain browser-only", async () => {
  const [page, tracking] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/approval-tracking.tsx", import.meta.url), "utf8"),
  ]);
  for (const text of [
    "核准公文追蹤",
    "前往核准追蹤",
    "市政府核准公文",
    "國稅局核准公文",
    "尚未收到",
    "已收到",
    "已歸檔",
    "正本已收到",
    "客戶份已寄出",
    "儲存追蹤資料",
    "檔案僅供本次辨識／預覽，不會永久保存",
    "請人工確認核准日期與公文字號",
    "複製雲端路徑",
  ])
    assert.match(`${page}\n${tracking}`, new RegExp(text));
  assert.match(page, /step === 4/);
  assert.match(page, /setActiveCaseId\(item\.id\)/);
  assert.doesNotMatch(page, /item\.companyName === "範例工程有限公司"/);
  assert.match(tracking, /extractDocument/);
  assert.match(tracking, /發文字號\|文號/);
  assert.match(tracking, /year < 1911 \? year \+ 1911 : year/);
  assert.match(tracking, /navigator\.clipboard\.writeText/);
  assert.match(tracking, /body: JSON\.stringify\(tracking\)/);
  assert.doesNotMatch(
    tracking,
    /body:\s*(?:file|localFiles)|base64|FileReader|arrayBuffer/,
  );
});

test("registration form DOCX is a two-page A4 table using dynamic official fields", async () => {
  const bytes = buildRegistrationFormDocx({
    company: "範例工程有限公司",
    precheck: "115004506",
    registrationAddress: "臺中市西屯區台灣大道三段99號12樓",
    capital: "1,000,000",
    representative: "王小明",
    nationalId: "A123456789",
    contactAddress: "臺北市中正區範例路1號",
    contactPhone: "",
    registrationPostalCode: "",
    contactPostalCode: "330018",
    business: [
      "E599010 配管工程業",
      "E601010 電器承裝業",
      "E603050 自動控制設備工程業",
      "E603090 照明設備安裝工程業",
      "IG03010 能源技術服務業",
      "ZZ99999 除許可業務外",
    ],
  });
  const documentXml = strFromU8(unzipSync(bytes)["word/document.xml"]);
  for (const marker of [
    "有限公司設立登記表",
    "印章",
    "預查編號",
    "統一編號",
    "公司所在地",
    "資本總額",
    "董事人數",
    "代表人姓名",
    "公司章程訂定日期",
    "所營事業",
    "董事、股東名單",
    "公務記載蓋章欄",
    "範例工程有限公司",
    "王小明",
    "A123456789",
    "115004506",
    "E599010",
    "配管工程業",
    "<w:tbl>",
    "<w:tblBorders>",
    "<w:tblGrid>",
    "<w:tcW",
    'w:type="page"',
    'w:w="11906"',
    "標楷體",
    "公司印章",
    "代表公司負責人印章",
    "公司預查編號",
    "公司統一編號",
    "公司聯絡電話",
    "僑外投資事業",
    "陸資",
    "一人公司",
    "擬合併公司資料明細",
    "核准登記日期文號",
    "編號",
    "代碼",
    "營業項目說明",
    "姓名(或法人名稱)",
    "身分證號(或法人統一編號)",
    "出資額(元)",
    "(郵遞區號)住所或居所(或法人所在地)",
  ])
    assert.ok(documentXml.includes(marker), marker);
  assert.ok((documentXml.match(/<w:tr>/g) ?? []).length >= 25);
  assert.match(documentXml, /<w:trHeight w:val="1600" w:hRule="atLeast"\/>/);
  assert.match(documentXml, /<w:trHeight w:val="1400" w:hRule="atLeast"\/>/);
  assert.equal((documentXml.match(/330018/g) ?? []).length, 1);
  assert.match(documentXml, /330018臺北市中正區範例路1號/);
  assert.match(documentXml, />臺中市西屯區台灣大道三段99號12樓</);
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    page,
    /key:\s*"city_registration_form"[\s\S]{0,180}kind:\s*"generated"[\s\S]{0,120}generatedKey:\s*"registration_form"/,
  );
  assert.match(page, /待補公司所在地/);
  assert.match(page, /!form\.registrationAddress/);
  assert.match(page, /registrationPostalCode/);
  assert.match(page, /contactPostalCode/);
  assert.doesNotMatch(page, /\bpostalCode\b/);
  assert.match(page, /splitPdfPages/);
  assert.match(page, /!splitAdded[\s\S]{0,180}originals\.add\(source\)/);
});
