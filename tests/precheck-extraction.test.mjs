import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidPrecheckNumber,
  normalizePrecheckNumber,
  normalizeRocDate,
  parsePrecheckText,
} from "../lib/precheck-extraction.mjs";

// All names and numbers in this file are synthetic test data, not customer data.
test("precheck number accepts OCR spacing and punctuation but rejects implausible values", () => {
  assert.equal(normalizePrecheckNumber("１１５-９９９ ９９９"), "115999999");
  assert.equal(isValidPrecheckNumber("115 999 999"), true);
  assert.equal(isValidPrecheckNumber("079999999"), false);
  assert.equal(isValidPrecheckNumber("115000000"), false);
  assert.equal(isValidPrecheckNumber("11599999"), false);
});

test("ROC and western dates normalize to ROC YYY/MM/DD", () => {
  assert.equal(normalizeRocDate("民國 115 年 8 月 6 日"), "115/08/06");
  assert.equal(normalizeRocDate("2026-08-06"), "115/08/06");
  assert.equal(normalizeRocDate("１１５．０２．２９"), "");
  assert.equal(normalizeRocDate("2024/02/29"), "113/02/29");
});

test("parser handles OCR label variants and returns only labeled company and coded items", () => {
  const parsed = parsePrecheckText([
    {
      text: [
        "公司名稱及所營事業登記預查核定書",
        "預 查 案 號 ： １１５ - ９９９ - ９９９",
        "核 定 日 期：西元 2026 年 02 月 03 日",
        "核准名稱保留期限：民國 115 年 08 月 03 日",
        "核准之公司名稱：測試創意有限公司",
        "所營事業項目",
        "E 5 9 9 0 1 0　配管工程業",
        "F113020",
        "電器批發業",
        "這一行沒有營業項目代碼，不應被收錄",
        "ZZ 99999 除許可業務外，得經營法令非禁止或限制之業務",
      ].join("\n"),
    },
  ]);
  assert.deepEqual(parsed, {
    precheckNumber: "115999999",
    approvalDate: "115/02/03",
    expiryDate: "115/08/03",
    companyName: "測試創意有限公司",
    businessItems: [
      { code: "E599010", name: "配管工程業" },
      { code: "F113020", name: "電器批發業" },
      {
        code: "ZZ99999",
        name: "除許可業務外，得經營法令非禁止或限制之業務",
      },
    ],
  });
});

test("parser stays conservative when fields are unlabeled or malformed", () => {
  const parsed = parsePrecheckText([
    { text: "115999999\n隨機文字測試有限公司\n配管工程業\nA123456" },
  ]);
  assert.deepEqual(parsed, {
    precheckNumber: "",
    approvalDate: "",
    expiryDate: "",
    companyName: "",
    businessItems: [],
  });
});

test("parser supports compact dates in continuous PDF text", () => {
  const parsed = parsePrecheckText(
    "公司名稱及所營事業登記預查核定書 預查編號：115999999 核准日期：1150203 核准保留期限：1150803 一、核准之公司名稱：測試創意有限公司 E599010 配管工程業",
  );
  assert.equal(parsed.approvalDate, "115/02/03");
  assert.equal(parsed.expiryDate, "115/08/03");
  assert.equal(parsed.companyName, "測試創意有限公司");
});
