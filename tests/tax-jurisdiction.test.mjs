import assert from "node:assert/strict";
import test from "node:test";
import {
  inferTaxBureau,
  inferTaxJurisdiction,
  purchaseProofOfficeOptions,
} from "../lib/tax-jurisdiction.mjs";

test("business addresses map to the five national tax bureaus", () => {
  const samples = [
    ["臺北市信義區福德街86號", "A05", "台北"],
    ["新北市板橋區文化路一段1號", "H01", "北區"],
    ["台中市北屯區崇德路二段1號", "B01", "中區"],
    ["臺南市安南區安中路一段1號", "D01", "南區"],
    ["高雄市三民區建國一路1號", "E01", "高雄"],
  ];
  for (const [address, code, shortName] of samples) {
    const result = inferTaxBureau(address);
    assert.equal(result?.bureauCode, code, address);
    assert.equal(result?.bureauShortName, shortName, address);
  }
});

test("purchase-proof jurisdiction reaches the local branch or collection office", () => {
  assert.equal(inferTaxJurisdiction("臺中市北屯區崇德路二段1號")?.branchName, "東山稽徵所");
  assert.equal(inferTaxJurisdiction("新北市永和區中山路一段1號")?.branchName, "中和稽徵所");
  assert.equal(inferTaxJurisdiction("高雄市三民區建國一路1號")?.branchName, "三民分局");
  assert.equal(inferTaxJurisdiction("高雄市鳳山區光遠路1號")?.branchName, "鳳山分局");
  assert.ok(purchaseProofOfficeOptions("高雄").includes("岡山稽徵所"));
});

test("Taipei Zhongshan addresses stay explicit when east/west side is unknown", () => {
  const ambiguous = inferTaxJurisdiction("臺北市中山區松江路100號");
  assert.equal(ambiguous?.branchName, "");
  assert.equal(ambiguous?.needsBranchConfirmation, true);
  assert.deepEqual(ambiguous?.branchCandidates, ["中北稽徵所", "中南稽徵所"]);
  assert.equal(inferTaxJurisdiction("臺北市中山區松江路以東")?.branchName, "中北稽徵所");
});
