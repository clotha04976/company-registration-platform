import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  businessItems,
  findBusinessItem,
  formatBusinessItem,
  parseBusinessItem,
  searchBusinessItems,
} from "../lib/business-scope.mjs";

test("the bundled catalogue keeps every published business item", () => {
  assert.ok(businessItems.length > 700);
  assert.equal(
    new Set(businessItems.map((item) => item.code)).size,
    businessItems.length,
  );
  assert.deepEqual(findBusinessItem("E801010"), {
    code: "E801010",
    name: "室內裝潢業",
    category: "E",
    categoryName: "營造及工程業",
  });
  assert.equal(findBusinessItem("e801010")?.name, "室內裝潢業");
  assert.equal(findBusinessItem("NOPE"), null);
});

test("search ranks exact codes above prefixes and label matches", () => {
  const byCode = searchBusinessItems("E801010");
  assert.equal(byCode[0].code, "E801010");
  const byPrefix = searchBusinessItems("E801");
  assert.ok(byPrefix.every((item) => item.code.startsWith("E801")));
  const byName = searchBusinessItems("室內裝潢");
  assert.ok(byName.some((item) => item.code === "E801010"));
  assert.ok(searchBusinessItems("E8", 5).length <= 5);
  assert.equal(searchBusinessItems("這不是營業項目").length, 0);
});

test("entries survive the round trip and tolerate pre-check OCR text", () => {
  assert.deepEqual(parseBusinessItem("E801010 室內裝潢業"), {
    code: "E801010",
    name: "室內裝潢業",
  });
  // A bare code still resolves its label from the catalogue.
  assert.equal(parseBusinessItem("E801010").name, "室內裝潢業");
  // OCR output without a usable code must not be thrown away.
  assert.deepEqual(parseBusinessItem("室內裝潢業"), {
    code: "",
    name: "室內裝潢業",
  });
  assert.equal(
    formatBusinessItem({ code: "ZZ99999", name: "除許可業務外，得經營法令非禁止或限制之業務" }),
    "ZZ99999 除許可業務外，得經營法令非禁止或限制之業務",
  );
  assert.equal(formatBusinessItem({ code: "", name: "手動輸入" }), "手動輸入");
});

test("the scope field confirms deletions and warns before adding an item", async () => {
  const field = await readFile(
    new URL("../app/business-scope-field.tsx", import.meta.url),
    "utf8",
  );
  assert.match(field, /確定要刪除/);
  assert.match(field, /確認刪除/);
  assert.match(field, /取消/);
  // The delete button must open the confirmation, never remove directly.
  assert.match(field, /onClick=\{\(\) => setConfirming\(true\)\}/);

  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /預查馬上辦/);
  assert.match(page, /名稱預查核定書/);
  assert.match(page, /setBusinessAdded\(true\)/);
});
