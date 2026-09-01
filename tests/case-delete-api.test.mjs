import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch { /* Server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("temporary ERP server did not start");
}

async function json(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { "content-type": "application/json" } : undefined,
  });
  const body = await response.json();
  return { response, body };
}

test("case and event delete APIs remove only the confirmed targets", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "erp-delete-test-"));
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [fileURLToPath(new URL("../server.mjs", import.meta.url))], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      PORT: String(port),
      APP_DATA_DIR: join(root, "data"),
      APP_BACKUP_DIR: join(root, "backups"),
    },
    stdio: "ignore",
    windowsHide: true,
  });
  context.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await waitForServer(url);

  const created = await json(`${url}/api/cases`, {
    method: "POST",
    body: JSON.stringify({
      receivedDate: "2026-08-27",
      companyName: "刪除功能測試有限公司",
      entityType: "公司",
      caseType: "新設立",
      caseContent: "公司新設立",
    }),
  });
  assert.equal(created.response.status, 201);
  const caseId = created.body.case.id;

  const event = await json(`${url}/api/cases/${caseId}/events`, {
    method: "POST",
    body: JSON.stringify({
      eventDate: "2026-08-28",
      status: "審查中",
      detail: "刪除測試歷程",
    }),
  });
  assert.equal(event.response.status, 201);
  const target = event.body.events.find((item) => item.detail === "刪除測試歷程");
  assert.ok(target);

  const deletedEvent = await json(`${url}/api/cases/${caseId}/events/${target.id}`, { method: "DELETE" });
  assert.equal(deletedEvent.response.status, 200);
  assert.equal(deletedEvent.body.events.some((item) => item.id === target.id), false);

  const deletedCase = await json(`${url}/api/cases/${caseId}`, { method: "DELETE" });
  assert.equal(deletedCase.response.status, 200);
  const missing = await json(`${url}/api/cases/${caseId}`);
  assert.equal(missing.response.status, 404);
});
