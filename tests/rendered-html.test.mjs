import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { buildDocx, buildZip } from "../lib/ooxml.mjs";

test("buildDocx creates a valid OOXML OPC package", () => {
  const bytes = buildDocx("股東同意書", ["茲同意設立範例工程有限公司。", "日期：　　年　　月　　日"]);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b);
  const parts = unzipSync(bytes);
  for (const name of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels", "docProps/core.xml", "docProps/app.xml"]) assert.ok(parts[name], `missing ${name}`);
  assert.match(strFromU8(parts["_rels/.rels"]), /officeDocument[^>]+Target="word\/document.xml"/);
  assert.match(strFromU8(parts["[Content_Types].xml"]), /wordprocessingml\.document\.main\+xml/);
  assert.match(strFromU8(parts["word/_rels/document.xml.rels"]), /relationships\/styles[^>]+Target="styles.xml"/);
  assert.match(strFromU8(parts["word/document.xml"]), /範例工程有限公司/);
});

test("batch ZIP preserves same-name files with unique names", () => {
  const bytes = buildZip([{ name: "附件.pdf", data: new Uint8Array([1]) }, { name: "附件.pdf", data: new Uint8Array([2]) }]);
  const files = unzipSync(bytes);
  assert.deepEqual(Object.keys(files).sort(), ["附件.pdf", "附件_2.pdf"]);
});

test("Step 1 follows the real staged intake workflow", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const text of ["名稱預查階段", "名稱核准後・市政府設立階段", "籌備處存摺", "租約／地址相關文件整包", "公司所在地（可稍後補）", "確認包含"]) assert.match(page, new RegExp(text));
  assert.match(page, /key: "passbook", phase: "名稱核准後・市政府設立階段"/);
  assert.doesNotMatch(page, /land_title.*required|house_tax.*required|building_consent.*required|floor_plan.*required/);
});

test("Step 3 exposes DOCX and all three batch downloads", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const text of ["下載市政府全部文件", "下載國稅局全部文件", "下載所有可用文件", "待提供正式範本，不納入批次下載", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"]) assert.match(page, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(page, /downloadXml|\.xml`|Word XML/);
  assert.match(page, /new Set<File>/);
});

test("case workflow supports four stages and backward-compatible completion", async () => {
  const [dashboard, schema, api, database] = await Promise.all([
    readFile(new URL("../app/cases-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cases/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/index.ts", import.meta.url), "utf8"),
  ]);
  for (const stage of ["name_precheck", "city_government", "national_tax", "completed"]) { assert.match(dashboard, new RegExp(stage)); assert.match(schema, new RegExp(stage)); }
  for (const label of ["名稱預查", "市政府", "國稅局", "已結案"]) assert.match(dashboard, new RegExp(label));
  assert.match(api, /action === "complete"/); assert.match(api, /action === "restore"/); assert.match(api, /stage = 'national_tax'/);
  assert.match(database, /PRAGMA table_info\(cases\)/); assert.match(database, /ALTER TABLE cases ADD COLUMN stage/);
});

test("dashboard counts all cases by created month and exposes no compensation data", async () => {
  const [dashboard, route] = await Promise.all([
    readFile(new URL("../app/cases-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cases/dashboard/route.ts", import.meta.url), "utf8"),
  ]);
  for (const forbidden of ["獎金", "NT$500", "bonusPerCase", "bonusTotal", "bonusTwd"]) assert.doesNotMatch(dashboard, new RegExp(forbidden));
  assert.match(route, /substr\(c\.created_at, 1, 7\)/);
  assert.match(route, /substr\(cases\.created_at, 1, 7\)/);
  assert.doesNotMatch(route, /COUNT[^"\n]*completed_at|WHERE[^"\n]*completed_at|status\s*=\s*'completed'/);
  assert.match(dashboard, /統計月份/);
  assert.match(dashboard, /目前使用者所選月件數/);
  assert.match(dashboard, /開案件數/);
  assert.match(dashboard, /結案月份/);
});

test("history details open as a read-only preview without changing case state", async () => {
  const dashboard = await readFile(new URL("../app/cases-dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /selectedHistoryCase/);
  assert.match(dashboard, /唯讀預覽/);
  assert.match(dashboard, /返回歷史/);
  assert.match(dashboard, /onClick=\{\(\) => setSelectedHistoryCase\(item\)\}>查看資料/);
  assert.doesNotMatch(dashboard, /update\([^)]*action:\s*"restore"[^)]*\)[^<]*>查看資料/);
  assert.match(dashboard, /className="secondary" onClick=\{\(\) => void update\(item\.id, \{ action: "restore" \}/);
});

test("selected-month employee count expands monthly cases with safe routing", async () => {
  const [dashboard, route] = await Promise.all([
    readFile(new URL("../app/cases-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cases/dashboard/route.ts", import.meta.url), "utf8"),
  ]);
  for (const field of ["monthlyCases", "companyName", "summary", "employeeId", "employeeName", "stage", "status", "progress", "createdAt", "completedAt"]) assert.match(route, new RegExp(field));
  assert.match(route, /WHERE substr\(c\.created_at, 1, 7\) = \?/);
  assert.match(dashboard, /所選月份目前使用者/);
  assert.match(dashboard, /開案明細/);
  assert.match(dashboard, /openMonthlyCase/);
  assert.match(dashboard, /item\.status !== "completed"\) \{ onOpenWizard\(item\); return; \}/);
  assert.match(dashboard, /setShowMonthlyCases\(false\)/);
  assert.match(dashboard, /setSelectedHistoryCase\(item\)/);
  assert.match(dashboard, /history-readonly-preview/);
  assert.match(dashboard, /scrollIntoView/);
  assert.doesNotMatch(dashboard, /openMonthlyCase[\s\S]{0,180}restore/);
});

test("stale cases use a 30-day ongoing-only reminder and safe keep-active touch", async () => {
  const [dashboard, route, patchRoute] = await Promise.all([
    readFile(new URL("../app/cases-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cases/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cases/[id]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /status = 'ongoing' AND datetime\(updated_at\) <= datetime\(\?, '-30 days'\)/);
  assert.match(route, /c\.status = 'ongoing' AND datetime\(c\.updated_at\) <= datetime\(\?, '-30 days'\)/);
  assert.match(route, /staleCount/); assert.match(route, /staleCases/);
  const keepActiveSql = patchRoute.match(/body\.action === "keep_active"\) await db\.prepare\("([^"]+)"\)/)?.[1] ?? "";
  assert.equal(keepActiveSql, "UPDATE cases SET updated_at = ? WHERE id = ? AND status = 'ongoing'");
  const keepActiveSetClause = keepActiveSql.split(/\s+WHERE\s+/i)[0];
  assert.doesNotMatch(keepActiveSetClause, /stage\s*=|status\s*=|progress\s*=|completed_at\s*=/);
  for (const copy of ["待確認", "仍在辦理", "案件已30天未更新，請確認進度", "是否已完成國稅局送件並可結案？", "case-stale", "stale-warning"]) assert.match(dashboard, new RegExp(copy));
  assert.doesNotMatch(route, /action:\s*"complete"/);
});

test("sensitive data remains fully visible in confirmation and documents", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /A123456789/); assert.match(page, /身分證字號（完整顯示）/); assert.doesNotMatch(page, /遮罩|碼掉|mask/i);
  for (const retainedContent of ["王小明", "臺北市中正區範例路1號", "第十六條", "公司大章", "親簽"]) assert.match(page, new RegExp(retainedContent));
  assert.doesNotMatch(page, /Vue\.js|FastAPI|SQLite/);
});
