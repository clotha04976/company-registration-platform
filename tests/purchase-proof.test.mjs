import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { extractVisibleText, generatePurchaseProofDocx } from "../purchase-proof-docx.mjs";

const checkboxes = {
  page1: {
    registration: { establishment: true },
    reason: { new: true },
    attachments: { agentPickup: true },
    relation: { otherOffice: true },
    invoiceTypes: { twoCopy: true, threeCopy: true },
  },
  page2: {
    services: { purchase: true, receiveCertificate: true },
    qualification: { bookkeeper: true },
    actions: { purchase: true, receiveCertificate: true },
  },
};

test("purchase-proof template is generic and generates all four selected pages", async () => {
  const buffer = await generatePurchaseProofDocx({
    request: {
      applicationDate: { year: "115", month: "9", day: "" },
      officialDate: { year: "115", month: "8", day: "31" },
      taxBureauName: "北區",
      branchName: "範例稽徵所",
      salesDocumentNumber: "12345",
      selectedPages: [1, 2, 3, 4],
      checkboxes,
    },
    customer: {
      unifiedNumber: "12345678",
      taxRegistrationNumber: "123456789",
      companyName: "範例工程有限公司",
      responsiblePerson: "王小明",
      address: "臺北市中正區範例路1號",
      email: "sample@example.test",
      phone: "02-12345678",
      responsiblePersonId: "A123456789",
    },
    office: {
      name: "範例記帳士事務所",
      unifiedNumber: "87654321",
      responsiblePerson: "陳小華",
      responsiblePersonId: "B123456789",
      address: "臺北市中正區範例街2號",
      phone: "02-87654321",
      mediaCode: "123456",
      licenseNumber: "12345",
    },
    page4Office: {
      name: "範例記帳士事務所",
      unifiedNumber: "87654321",
      responsiblePerson: "陳小華",
      responsiblePersonId: "B123456789",
      address: "臺北市中正區範例街2號",
      phone: "02-87654321",
      mediaCode: "123456",
      licenseNumber: "12345",
    },
  });
  const documentXml = strFromU8(unzipSync(buffer)["word/document.xml"]);
  const visible = extractVisibleText(documentXml);
  for (const title of [
    "領用統一發票購票證申請書",
    "營業人委任代理委任書",
    "集中購買統一發票申請書",
    "委任專業代理人查詢下載電子發票相關業務申請書",
  ]) assert.match(visible, new RegExp(title));
  assert.match(visible, /範例記帳士事務所/);
  assert.match(visible, /範例工程有限公司/);
  assert.doesNotMatch(documentXml, /MERGEFIELD|\{\{OFFICE_/);
});

test("ERP exposes multi-office profiles and gates purchase proof after national-tax approval", async () => {
  const [server, approval, purchase, template] = await Promise.all([
    readFile(new URL("../server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/approval-tracking.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/purchase-proof-application.tsx", import.meta.url), "utf8"),
    readFile(new URL("../templates/purchase-proof-template.docx", import.meta.url)),
  ]);
  assert.match(server, /CREATE TABLE IF NOT EXISTS accounting_offices/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS case_purchase_proof/);
  assert.match(server, /\/api\/accounting-offices/);
  assert.match(server, /purchaseProofDocxMatch/);
  assert.match(server, /國稅局核准公文標記為已收到或已歸檔/);
  assert.match(approval, /PurchaseProofApplication/);
  assert.match(purchase, /管理事務所/);

  const files = unzipSync(template);
  const xml = Object.entries(files)
    .filter(([name]) => /\.(?:xml|rels)$/i.test(name))
    .map(([, value]) => strFromU8(value))
    .join("\n");
  assert.doesNotMatch(xml, /\b[A-Z][12]\d{8}\b/);
  assert.doesNotMatch(xml, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
});
