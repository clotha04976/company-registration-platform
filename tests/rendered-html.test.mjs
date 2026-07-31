import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("source keeps the case dashboard capability", async () => {
  const [page, dashboard, api] = await Promise.all([readFile(new URL("../app/page.tsx", import.meta.url), "utf8"), readFile(new URL("../app/cases-dashboard.tsx", import.meta.url), "utf8"), readFile(new URL("../app/api/cases/dashboard/route.ts", import.meta.url), "utf8")]);
  assert.match(page, /CasesDashboard/);
  assert.match(dashboard, /onOpenWizard/);
  assert.match(api, /bonusPerCase: 500/);
});

test("Step 1 has three source phases, nine independent document slots, and no system outputs", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const phase of ["名稱預查", "市政府設立", "國稅局接續"]) assert.match(page, new RegExp(phase));
  for (const key of ["name_reservation", "identity", "land_title", "house_tax", "passbook", "building_consent", "lease", "floor_plan", "other"]) assert.match(page, new RegExp(`key: "${key}"`));
  assert.match(page, /後續將沿用/);
  assert.match(page, /pdf", "jpg", "jpeg", "png", "doc", "docx/);
  assert.match(page, /previewFile/);
  assert.match(page, /替換/);
  assert.match(page, /刪除/);
  assert.match(page, /Record<SlotKey, File\[\]>/);
  assert.doesNotMatch(page, /章程上傳|股東同意書上傳|董事願任同意書上傳|申請書上傳/);
});

test("multi-page lease links require confirmation and retain page-range source metadata", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /type SourceLink/);
  assert.match(page, /status: "suggested" \| "confirmed" \| "dismissed"/);
  assert.match(page, /示範辨識／未實際執行 OCR，需人工確認/);
  assert.match(page, /未確認前不視為已收到/);
  assert.match(page, /確認關聯/);
  assert.match(page, /取消關聯/);
  assert.match(page, /pageRange/);
  assert.match(page, /包含在租約檔案中/);
  assert.match(page, /previewFile\(files\.lease\[0\]\)/);
});

test("Word XML and original downloads have the required safeguards", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const marker of ["<?xml version", "mso-application progid", "<w:wordDocument", "w:w=\"11906\" w:h=\"16838\"", "DFKai-SB", "xmlEscape", "downloadXml", "downloadOriginalFile"]) assert.ok(page.includes(marker));
  assert.match(page, /待提供正式範本/);
  assert.match(page, /第一條　本公司依照公司法規定組織/);
  assert.match(page, /第十六條　本章程訂立於民國＿＿年＿＿月＿＿日/);
  assert.match(page, /茲同意設立\$\{form\.company\}，訂定公司章程，並選任\$\{form\.representative\}為董事/);
  assert.match(page, /日期為存入資本額日期，請先留空/);
  assert.match(page, /日期可填寫簽名當天日期/);
  assert.match(page, /範例工程有限公司/);
  assert.match(page, /臺北市中正區範例路1號/);
  assert.match(page, /名稱保留期限已屆滿，送件前請先確認是否仍可使用或需重新預查/);
  assert.match(page, /validFiles/);
  assert.match(page, /可下載 \$\{count\} 份原始附件/);
  assert.doesNotMatch(page, /genericContent|getContent|text\/plain|downloadText/);
});
