import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Behavioural coverage for these rules lives in api-service/tests/test_cases.py.
// This guards the SQL and the stage transitions the dashboard depends on.
test("case API validates bodies, returns 404, and reports stage metadata", async () => {
  const source = await readFile(
    new URL("../api-service/app/cases.py", import.meta.url),
    "utf8",
  );
  // Python splits long SQL across adjacent literals; join them before matching.
  const api = source.replace(/"\s*\n\s*"/g, "");
  assert.match(api, /SELECT stage, status FROM cases WHERE id = \?/);
  assert.match(api, /HTTPException\(404, "找不到案件。"\)/);
  assert.match(api, /parse_case_id\(raw_id, "案件編號無效。"\)/);
  assert.match(api, /HTTPException\(400, message\)/);
  assert.match(api, /advance_after_precheck/);
  assert.match(api, /stage == "name_precheck" and status == "ongoing"/);
  assert.match(api, /status = 'ongoing' AND stage = 'name_precheck'/);
  assert.match(api, /stage == "city_government" and status == "ongoing"/);
  assert.match(api, /after_stage == "city_government"/);
  assert.match(api, /UPDATE cases SET status = 'ongoing', stage = \?, progress = \?, /);
  assert.match(api, /completed_at = NULL, updated_at = \? WHERE id = \?/);
});
