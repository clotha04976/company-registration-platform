import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Node ERP owns the complete case workflow and case-scoped preparation", async () => {
  const [server, dashboard, page] = await Promise.all([
    readFile(new URL("../server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/cases-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  for (const status of ["準備中", "待補資料", "已送件", "審查中", "補件", "核准", "國稅局辦理", "結案"])
    assert.match(`${server}\n${dashboard}`, new RegExp(status));

  assert.match(server, /preparationMatch = url\.pathname\.match/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS case_preparation/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS case_events/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS billing_items/);
  assert.match(page, /\/preparation/);
  assert.match(page, /原始身分證圖片不會寫入資料庫/);
  const preparationRoute = server.slice(
    server.indexOf("const preparationMatch"),
    server.indexOf("const approvalsMatch"),
  );
  assert.doesNotMatch(preparationRoute, /formData|file_bytes|identity_image|BLOB/i);
});
