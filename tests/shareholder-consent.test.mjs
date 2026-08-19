import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import {
  buildShareholderConsent,
  consentTopicsFor,
  findConsentTopic,
} from "../lib/shareholder-consent.mjs";
import {
  buildRegistrationFormDocx,
  buildShareholderConsentDocx,
} from "../lib/ooxml.mjs";

const documentText = (bytes) =>
  strFromU8(unzipSync(bytes)["word/document.xml"]);

test("the setup consent names the company and every elected director", () => {
  const consent = buildShareholderConsent({
    company: "範例工程有限公司",
    directors: ["王小明"],
    shareholders: [
      { name: "王小明", nationalId: "A123456789", capital: "600,000" },
      { name: "張淑美", nationalId: "V221058650", capital: "400,000" },
    ],
  });
  assert.equal(consent.title, "範例工程有限公司股東同意書");
  assert.equal(consent.rows.length, 1);
  assert.equal(consent.rows[0].subject, "公司設立");
  assert.equal(
    consent.rows[0].body,
    "茲同意設立範例工程有限公司，訂定公司章程，並選任王小明為董事。",
  );
  assert.equal(consent.shareholders.length, 2);
  assert.equal(consent.shareholders[1].name, "張淑美");
});

test("shareholders without a name are left out of the signature block", () => {
  const consent = buildShareholderConsent({
    company: "測試有限公司",
    directors: ["甲"],
    shareholders: [{ name: "甲" }, { name: "  " }, { name: "乙" }],
  });
  assert.deepEqual(
    consent.shareholders.map((item) => item.name),
    ["甲", "乙"],
  );
});

test("change-registration topics stay available for later filings", () => {
  const change = consentTopicsFor("change");
  assert.ok(change.length >= 5);
  assert.deepEqual(consentTopicsFor("setup").map((topic) => topic.key), [
    "incorporation",
  ]);
  assert.equal(
    findConsentTopic("name_change").body({ company: "新名有限公司" }),
    "茲同意本公司更名為新名有限公司，並同意修正公司章程如所附章程修正條文對照表。",
  );
  assert.equal(findConsentTopic("nope"), null);
});

test("the consent DOCX carries the official table, seal cell and one row per shareholder", () => {
  const consent = buildShareholderConsent({
    company: "範例工程有限公司",
    directors: ["王小明"],
    shareholders: [
      { name: "王小明", nationalId: "A123456789", capital: "600,000" },
      { name: "張淑美", nationalId: "V221058650", capital: "400,000" },
    ],
  });
  const text = documentText(buildShareholderConsentDocx(consent));
  for (const expected of [
    "申請事項",
    "同意內容",
    "(加蓋公司印章)",
    "股東姓名",
    "親自簽名",
    "王小明",
    "張淑美",
    "V221058650",
    "中　　華　　民　　國",
  ])
    assert.ok(text.includes(expected), `missing ${expected}`);
});

test("the registration form lists every shareholder and counts only directors", () => {
  const text = documentText(
    buildRegistrationFormDocx({
      company: "範例工程有限公司",
      precheck: "115004506",
      registrationAddress: "台中市西屯區台灣大道三段99號",
      capital: "1,000,000",
      representative: "王小明",
      nationalId: "A123456789",
      contactAddress: "桃園市桃園區民光東路363號",
      contactPhone: "",
      registrationPostalCode: "407",
      contactPostalCode: "330018",
      business: ["E801010 室內裝潢業"],
      shareholders: [
        { role: "董事", name: "王小明", nationalId: "A123456789", capital: "600,000" },
        { role: "股東", name: "張淑美", nationalId: "V221058650", capital: "400,000" },
      ],
    }),
  );
  assert.ok(text.includes("張淑美"));
  assert.ok(text.includes("V221058650"));
  assert.ok(text.includes("1 人"), "one director among two shareholders");
  assert.ok(text.includes("600,000"));
});

test("the wizard collects an open-ended shareholder roster and recognises each card", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /股東身分證明文件/);
  assert.match(page, /新增股東/);
  assert.match(page, /移除此股東/);
  assert.match(page, /processShareholderFile/);
  assert.match(page, /buildShareholderConsentDocx/);
  // The roster feeds both generated documents rather than only the representative.
  assert.match(page, /shareholders: roster/);
  assert.match(page, /出資額合計/);
});
