import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the company registration workflow", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /範例工程有限公司/);
  assert.match(html, /上傳文件並確認辨識結果/);
  assert.match(html, /本預覽在瀏覽器暫時處理，離開後不保存/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("source contains the three-step workflow and required document reminders", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /確認與修改擷取資料/);
  assert.match(page, /下載市政府應備書件/);
  assert.match(page, /日期可填寫簽名當天日期/);
  assert.match(page, /日期為存入資本額日期，請先留空/);
  assert.match(page, /公司大章空位/);
  assert.match(page, /茲同意設立\{company\}/);
  assert.match(page, /本人同意擔任\{company\}董事/);
});
