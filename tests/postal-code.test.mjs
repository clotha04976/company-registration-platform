import assert from "node:assert/strict";
import test from "node:test";
import {
  lookupTaiwanPostalCode,
  normalizePostalLookupAddress,
} from "../lib/postal-code.mjs";

test("postal lookup removes a barcode suffix and prefers 3+3 result", async () => {
  const address = "南投縣竹山鎮延祥里17鄰集山路三段301巷81弄62號0181691323";
  assert.equal(
    normalizePostalLookupAddress(address),
    "南投縣竹山鎮延祥里17鄰集山路三段301巷81弄62號",
  );
  let requestedUrl = "";
  const postalCode = await lookupTaiwanPostalCode(address, {
    minIntervalMs: 0,
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        json: async () => ({ zipcode6: "557012", zipcode: "55775" }),
      };
    },
  });
  assert.equal(postalCode, "557012");
  assert.match(decodeURIComponent(requestedUrl), /南投縣竹山鎮延祥里17鄰/);
  assert.doesNotMatch(requestedUrl, /0181691323/);
});

test("postal lookup fails safely for incomplete addresses", async () => {
  let called = false;
  const result = await lookupTaiwanPostalCode("集山路三段301巷", {
    minIntervalMs: 0,
    fetchImpl: async () => {
      called = true;
      throw new Error("should not run");
    },
  });
  assert.equal(result, "");
  assert.equal(called, false);
});
