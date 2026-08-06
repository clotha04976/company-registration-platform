import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("case API validates bodies, returns 404, and reports stage metadata", async () => {
  const api = await readFile(
    new URL("../app/api/cases/[id]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(api, /SELECT stage, status FROM cases WHERE id = \?/);
  assert.match(api, /status: 404/);
  assert.match(api, /status: 400/);
  assert.match(api, /advance_after_precheck/);
  assert.match(api, /row\.stage === "name_precheck" && row\.status === "ongoing"/);
  assert.match(api, /status = 'ongoing' AND stage = 'name_precheck'/);
  assert.match(api, /row\.stage === "city_government" && row\.status === "ongoing"/);
  assert.match(api, /after\.stage === "city_government"/);
  assert.match(api, /UPDATE cases SET status = 'ongoing', stage = \?, progress = \?, completed_at = NULL/);
  assert.doesNotMatch(
    api,
    /advance_after_precheck[\s\S]*UPDATE cases SET status = 'ongoing', stage = 'city_government'[\s\S]*stage IN/,
  );
});
