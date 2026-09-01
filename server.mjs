import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";
import { OfficialQueryError, queryOfficialCases } from "./official-query.mjs";
import { generatePurchaseProofDocx } from "./purchase-proof-docx.mjs";
import { TaxQueryError, createTaxCaptcha, queryTaxCases, taxBureaus, taxQueryUrl } from "./tax-query.mjs";
import { closeCaptchaOcr, recognizeTaxCaptcha } from "./captcha-ocr.mjs";
import { inferTaxBureau, inferTaxJurisdiction } from "./lib/tax-jurisdiction.mjs";

const rootDir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(rootDir, "dist");
const dataDir = resolve(process.env.APP_DATA_DIR || join(rootDir, "data"));
const backupsDir = resolve(process.env.APP_BACKUP_DIR || join(rootDir, "backups"));
const databasePath = join(dataDir, "cases.sqlite");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5566);

const statuses = new Set([
  "準備中", "待送件", "已送件", "審查中", "補件", "打字中", "校對中",
  "核准發文中", "可自領", "郵寄", "電子送達", "已領件", "國稅局辦理", "結案", "取消",
  "待補資料", "資料確認", "送件中", "核准",
]);
const entityTypes = new Set(["公司", "行號"]);
const taxOfficeValues = new Set(["未確認", "需要", "辦理中", "不需要", "已完成"]);
const taxBureauCodes = new Set(Object.keys(taxBureaus));
const billingStatuses = new Set(["未請款", "已請款", "已收款"]);
const approvalStatuses = new Set(["not_received", "received", "archived"]);
const officeQualificationTypes = new Set(["bookkeeper", "accountant", "tax_agent"]);

mkdirSync(dataDir, { recursive: true });
mkdirSync(backupsDir, { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_number TEXT NOT NULL UNIQUE,
    received_date TEXT NOT NULL,
    client_name TEXT NOT NULL DEFAULT '',
    company_name TEXT NOT NULL,
    tax_id TEXT NOT NULL DEFAULT '',
    case_type TEXT NOT NULL,
    case_content TEXT NOT NULL,
    status TEXT NOT NULL,
    status_detail TEXT NOT NULL DEFAULT '',
    service_fee INTEGER NOT NULL DEFAULT 0 CHECK (service_fee >= 0),
    government_fee INTEGER NOT NULL DEFAULT 0 CHECK (government_fee >= 0),
    paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    payment_date TEXT NOT NULL DEFAULT '',
    closed_date TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    representative TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    capital INTEGER NOT NULL DEFAULT 0 CHECK (capital >= 0),
    authority TEXT NOT NULL DEFAULT '',
    official_receipt_no TEXT NOT NULL DEFAULT '',
    progress_url TEXT NOT NULL DEFAULT '',
    official_status TEXT NOT NULL DEFAULT '',
    official_checked_at TEXT NOT NULL DEFAULT '',
    official_agency_code TEXT NOT NULL DEFAULT '',
    official_sub_case_no TEXT NOT NULL DEFAULT '',
    official_received_date TEXT NOT NULL DEFAULT '',
    official_outgoing_no TEXT NOT NULL DEFAULT '',
    official_outgoing_date TEXT NOT NULL DEFAULT '',
    official_subject TEXT NOT NULL DEFAULT '',
    entity_type TEXT NOT NULL DEFAULT '公司',
    precheck_no TEXT NOT NULL DEFAULT '',
    submitted_date TEXT NOT NULL DEFAULT '',
    tax_office_required TEXT NOT NULL DEFAULT '未確認',
    tax_bureau_code TEXT NOT NULL DEFAULT '',
    tax_receipt_no TEXT NOT NULL DEFAULT '',
    tax_received_date TEXT NOT NULL DEFAULT '',
    tax_case_type TEXT NOT NULL DEFAULT '',
    tax_official_status TEXT NOT NULL DEFAULT '',
    tax_checked_at TEXT NOT NULL DEFAULT '',
    billing_status TEXT NOT NULL DEFAULT '未請款',
    billing_date TEXT NOT NULL DEFAULT '',
    next_follow_up_date TEXT NOT NULL DEFAULT '',
    reg_unit_code TEXT NOT NULL DEFAULT '17',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function ensureCaseColumn(name, definition) {
  const existing = new Set(db.prepare("PRAGMA table_info(cases)").all().map((column) => column.name));
  if (!existing.has(name)) db.exec(`ALTER TABLE cases ADD COLUMN ${name} ${definition}`);
}

ensureCaseColumn("status_detail", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("entity_type", "TEXT NOT NULL DEFAULT '公司'");
ensureCaseColumn("precheck_no", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("submitted_date", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("tax_office_required", "TEXT NOT NULL DEFAULT '未確認'");
ensureCaseColumn("tax_bureau_code", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("tax_receipt_no", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("tax_received_date", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("tax_case_type", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("tax_official_status", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("tax_checked_at", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("billing_status", "TEXT NOT NULL DEFAULT '未請款'");
ensureCaseColumn("billing_date", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("next_follow_up_date", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("reg_unit_code", "TEXT NOT NULL DEFAULT '17'");
ensureCaseColumn("official_status", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("official_checked_at", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("official_agency_code", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("official_sub_case_no", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("official_received_date", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("official_outgoing_no", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("official_outgoing_date", "TEXT NOT NULL DEFAULT ''");
ensureCaseColumn("official_subject", "TEXT NOT NULL DEFAULT ''");

db.prepare(`
  UPDATE cases SET progress_url = ?
  WHERE entity_type = '行號' AND official_receipt_no <> '' AND official_agency_code = ''
`).run("https://serv.gcis.nat.gov.tw/caseSearch/list/QueryBusmCaseList/queryBusmCaseList.do");

db.exec(`
  CREATE TABLE IF NOT EXISTS case_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    event_date TEXT NOT NULL,
    event_type TEXT NOT NULL DEFAULT '進度',
    status TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS billing_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
    notes TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS case_preparation (
    case_id INTEGER PRIMARY KEY,
    representative TEXT NOT NULL DEFAULT '',
    national_id TEXT NOT NULL DEFAULT '',
    birth_date TEXT NOT NULL DEFAULT '',
    precheck_no TEXT NOT NULL DEFAULT '',
    approval_date TEXT NOT NULL DEFAULT '',
    expiry_date TEXT NOT NULL DEFAULT '',
    contact_address TEXT NOT NULL DEFAULT '',
    registration_address TEXT NOT NULL DEFAULT '',
    contact_phone TEXT NOT NULL DEFAULT '',
    registration_postal_code TEXT NOT NULL DEFAULT '',
    contact_postal_code TEXT NOT NULL DEFAULT '',
    capital_text TEXT NOT NULL DEFAULT '',
    representative_capital TEXT NOT NULL DEFAULT '',
    business_json TEXT NOT NULL DEFAULT '[]',
    shareholders_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS case_approval_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    agency TEXT NOT NULL CHECK (agency IN ('city_government', 'national_tax')),
    status TEXT NOT NULL DEFAULT 'not_received' CHECK (status IN ('not_received', 'received', 'archived')),
    approval_date TEXT,
    document_number TEXT,
    cloud_path TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
    UNIQUE(case_id, agency)
  );

  CREATE TABLE IF NOT EXISTS registration_card_tracking (
    case_id INTEGER PRIMARY KEY,
    original_received INTEGER NOT NULL DEFAULT 0,
    customer_copy_sent INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS accounting_offices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL DEFAULT '',
    unified_number TEXT NOT NULL DEFAULT '',
    responsible_person TEXT NOT NULL DEFAULT '',
    responsible_person_id TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    qualification_type TEXT NOT NULL DEFAULT 'bookkeeper',
    media_code TEXT NOT NULL DEFAULT '',
    license_number TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS case_purchase_proof (
    case_id INTEGER PRIMARY KEY,
    office_id INTEGER,
    page4_office_id INTEGER,
    tax_registration_number TEXT NOT NULL DEFAULT '',
    responsible_person_id TEXT NOT NULL DEFAULT '',
    business_phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    tax_bureau_name TEXT NOT NULL DEFAULT '',
    branch_name TEXT NOT NULL DEFAULT '',
    sales_document_number TEXT NOT NULL DEFAULT '',
    application_year TEXT NOT NULL DEFAULT '',
    application_month TEXT NOT NULL DEFAULT '',
    application_day TEXT NOT NULL DEFAULT '',
    official_year TEXT NOT NULL DEFAULT '',
    official_month TEXT NOT NULL DEFAULT '',
    official_day TEXT NOT NULL DEFAULT '',
    selected_pages_json TEXT NOT NULL DEFAULT '[1,2,3,4]',
    checkboxes_json TEXT NOT NULL DEFAULT '{}',
    generated_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
    FOREIGN KEY (office_id) REFERENCES accounting_offices(id) ON DELETE SET NULL,
    FOREIGN KEY (page4_office_id) REFERENCES accounting_offices(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cases_received_date ON cases(received_date);
  CREATE INDEX IF NOT EXISTS idx_cases_tax_id ON cases(tax_id);
  CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
  CREATE INDEX IF NOT EXISTS idx_case_events_case_id ON case_events(case_id, event_date DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_billing_items_case_id ON billing_items(case_id, sort_order, id);
  CREATE INDEX IF NOT EXISTS idx_case_approval_documents_case_id ON case_approval_documents(case_id, status);
  CREATE INDEX IF NOT EXISTS idx_accounting_offices_active_name ON accounting_offices(active, name);
  CREATE INDEX IF NOT EXISTS idx_case_purchase_proof_office_id ON case_purchase_proof(office_id);

  INSERT INTO case_events (case_id, event_date, event_type, status, detail)
  SELECT c.id, c.received_date, '進度', c.status,
    CASE WHEN c.status_detail <> '' THEN c.status_detail ELSE '由舊版台帳匯入' END
  FROM cases c
  WHERE NOT EXISTS (SELECT 1 FROM case_events e WHERE e.case_id = c.id);
`);

const billingTotalExpr = "CASE WHEN bi.case_id IS NOT NULL THEN bi.total_amount ELSE c.service_fee + c.government_fee END";
const caseSelect = `
  SELECT
    c.id,
    c.case_number AS caseNumber,
    c.received_date AS receivedDate,
    CAST(substr(c.received_date, 1, 4) AS INTEGER) AS year,
    c.client_name AS clientName,
    c.company_name AS companyName,
    c.tax_id AS taxId,
    c.entity_type AS entityType,
    c.precheck_no AS precheckNo,
    c.case_type AS caseType,
    c.case_content AS caseContent,
    c.status,
    c.status_detail AS statusDetail,
    c.submitted_date AS submittedDate,
    c.tax_office_required AS taxOfficeRequired,
    c.tax_bureau_code AS taxBureauCode,
    c.tax_receipt_no AS taxReceiptNo,
    c.tax_received_date AS taxReceivedDate,
    c.tax_case_type AS taxCaseType,
    c.tax_official_status AS taxOfficialStatus,
    c.tax_checked_at AS taxCheckedAt,
    c.next_follow_up_date AS nextFollowUpDate,
    c.billing_status AS billingStatus,
    c.billing_date AS billingDate,
    ${billingTotalExpr} AS totalDue,
    c.paid_amount AS paidAmount,
    MAX(${billingTotalExpr} - c.paid_amount, 0) AS outstanding,
    CASE
      WHEN c.billing_status = '未請款' THEN '未請款'
      WHEN c.billing_status = '已收款' THEN '已收款'
      WHEN ${billingTotalExpr} > 0 AND c.paid_amount >= ${billingTotalExpr} THEN '已收款'
      WHEN c.paid_amount > 0 THEN '部分收款'
      ELSE '待收款'
    END AS paymentStatus,
    c.payment_date AS paymentDate,
    c.closed_date AS closedDate,
    c.notes,
    c.representative,
    c.address,
    c.capital,
    c.authority,
    c.official_receipt_no AS officialReceiptNo,
    c.progress_url AS progressUrl,
    c.official_status AS officialStatus,
    c.official_checked_at AS officialCheckedAt,
    c.official_agency_code AS officialAgencyCode,
    c.official_sub_case_no AS officialSubCaseNo,
    c.official_received_date AS officialReceivedDate,
    c.official_outgoing_no AS officialOutgoingNo,
    c.official_outgoing_date AS officialOutgoingDate,
    c.official_subject AS officialSubject,
    c.reg_unit_code AS regUnitCode,
    c.created_at AS createdAt,
    c.updated_at AS updatedAt,
    (SELECT MAX(e.event_date) FROM case_events e WHERE e.case_id = c.id) AS lastEventDate,
    (SELECT MAX(e.event_date) FROM case_events e WHERE e.case_id = c.id AND e.event_type = '進度') AS lastProgressDate
  FROM cases c
  LEFT JOIN (
    SELECT case_id, SUM(amount) AS total_amount
    FROM billing_items
    GROUP BY case_id
  ) bi ON bi.case_id = c.id
`;

const listCasesByYear = db.prepare(`${caseSelect} WHERE substr(c.received_date, 1, 4) = ? ORDER BY c.received_date DESC, c.id DESC`);
const listAllCases = db.prepare(`${caseSelect} ORDER BY c.received_date DESC, c.id DESC`);
const getCase = db.prepare(`${caseSelect} WHERE c.id = ?`);
const getEvents = db.prepare(`
  SELECT id, event_date AS eventDate, event_type AS eventType, status, detail, created_at AS createdAt
  FROM case_events WHERE case_id = ? ORDER BY event_date DESC, id DESC
`);
const findMatchingTaxEvent = db.prepare(`
  SELECT id FROM case_events
  WHERE case_id = ? AND event_type = '國稅局查詢' AND status = ? AND detail = ?
  LIMIT 1
`);
const deleteCaseEvent = db.prepare("DELETE FROM case_events WHERE id = ? AND case_id = ?");
const deleteCase = db.prepare("DELETE FROM cases WHERE id = ?");
const getBillingItems = db.prepare(`
  SELECT id, item_name AS itemName, amount, notes, sort_order AS sortOrder
  FROM billing_items WHERE case_id = ? ORDER BY sort_order, id
`);
const getPreparation = db.prepare(`
  SELECT representative, national_id AS nationalId, birth_date AS birthDate,
    precheck_no AS precheck, approval_date AS approval, expiry_date AS expiry,
    contact_address AS contactAddress, registration_address AS registrationAddress,
    contact_phone AS contactPhone, registration_postal_code AS registrationPostalCode,
    contact_postal_code AS contactPostalCode, capital_text AS capital,
    representative_capital AS representativeCapital, business_json AS businessJson,
    shareholders_json AS shareholdersJson, updated_at AS updatedAt
  FROM case_preparation WHERE case_id = ?
`);
const upsertPreparation = db.prepare(`
  INSERT INTO case_preparation (
    case_id, representative, national_id, birth_date, precheck_no, approval_date,
    expiry_date, contact_address, registration_address, contact_phone,
    registration_postal_code, contact_postal_code, capital_text,
    representative_capital, business_json, shareholders_json, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(case_id) DO UPDATE SET
    representative = excluded.representative,
    national_id = excluded.national_id,
    birth_date = excluded.birth_date,
    precheck_no = excluded.precheck_no,
    approval_date = excluded.approval_date,
    expiry_date = excluded.expiry_date,
    contact_address = excluded.contact_address,
    registration_address = excluded.registration_address,
    contact_phone = excluded.contact_phone,
    registration_postal_code = excluded.registration_postal_code,
    contact_postal_code = excluded.contact_postal_code,
    capital_text = excluded.capital_text,
    representative_capital = excluded.representative_capital,
    business_json = excluded.business_json,
    shareholders_json = excluded.shareholders_json,
    updated_at = CURRENT_TIMESTAMP
`);
const getApprovalDocuments = db.prepare(`
  SELECT agency, status, approval_date AS approvalDate,
    document_number AS documentNumber, cloud_path AS cloudPath,
    updated_at AS updatedAt
  FROM case_approval_documents WHERE case_id = ?
`);
const getRegistrationCard = db.prepare(`
  SELECT original_received AS originalReceived,
    customer_copy_sent AS customerCopySent, updated_at AS updatedAt
  FROM registration_card_tracking WHERE case_id = ?
`);
const upsertApprovalDocument = db.prepare(`
  INSERT INTO case_approval_documents (
    case_id, agency, status, approval_date, document_number, cloud_path, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(case_id, agency) DO UPDATE SET
    status = excluded.status,
    approval_date = excluded.approval_date,
    document_number = excluded.document_number,
    cloud_path = excluded.cloud_path,
    updated_at = CURRENT_TIMESTAMP
`);
const upsertRegistrationCard = db.prepare(`
  INSERT INTO registration_card_tracking (
    case_id, original_received, customer_copy_sent, updated_at
  ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(case_id) DO UPDATE SET
    original_received = excluded.original_received,
    customer_copy_sent = excluded.customer_copy_sent,
    updated_at = CURRENT_TIMESTAMP
`);
const accountingOfficeSelect = `
  SELECT id, name, short_name AS shortName, unified_number AS unifiedNumber,
    responsible_person AS responsiblePerson, responsible_person_id AS responsiblePersonId,
    address, phone, email, qualification_type AS qualificationType,
    media_code AS mediaCode, license_number AS licenseNumber,
    is_default AS isDefault, active, created_at AS createdAt, updated_at AS updatedAt
  FROM accounting_offices
`;
const listAccountingOffices = db.prepare(`${accountingOfficeSelect} ORDER BY is_default DESC, active DESC, name, id`);
const getAccountingOffice = db.prepare(`${accountingOfficeSelect} WHERE id = ?`);
const insertAccountingOffice = db.prepare(`
  INSERT INTO accounting_offices (
    name, short_name, unified_number, responsible_person, responsible_person_id,
    address, phone, email, qualification_type, media_code, license_number,
    is_default, active, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);
const updateAccountingOffice = db.prepare(`
  UPDATE accounting_offices SET name = ?, short_name = ?, unified_number = ?,
    responsible_person = ?, responsible_person_id = ?, address = ?, phone = ?,
    email = ?, qualification_type = ?, media_code = ?, license_number = ?,
    is_default = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
`);
const getPurchaseProof = db.prepare(`
  SELECT office_id AS officeId, page4_office_id AS page4OfficeId,
    tax_registration_number AS taxRegistrationNumber,
    responsible_person_id AS responsiblePersonId, business_phone AS businessPhone,
    email, tax_bureau_name AS taxBureauName, branch_name AS branchName,
    sales_document_number AS salesDocumentNumber,
    application_year AS applicationYear, application_month AS applicationMonth,
    application_day AS applicationDay, official_year AS officialYear,
    official_month AS officialMonth, official_day AS officialDay,
    selected_pages_json AS selectedPagesJson, checkboxes_json AS checkboxesJson,
    generated_at AS generatedAt, updated_at AS updatedAt
  FROM case_purchase_proof WHERE case_id = ?
`);
const upsertPurchaseProof = db.prepare(`
  INSERT INTO case_purchase_proof (
    case_id, office_id, page4_office_id, tax_registration_number,
    responsible_person_id, business_phone, email, tax_bureau_name, branch_name,
    sales_document_number, application_year, application_month, application_day,
    official_year, official_month, official_day, selected_pages_json,
    checkboxes_json, generated_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(case_id) DO UPDATE SET
    office_id = excluded.office_id, page4_office_id = excluded.page4_office_id,
    tax_registration_number = excluded.tax_registration_number,
    responsible_person_id = excluded.responsible_person_id,
    business_phone = excluded.business_phone, email = excluded.email,
    tax_bureau_name = excluded.tax_bureau_name, branch_name = excluded.branch_name,
    sales_document_number = excluded.sales_document_number,
    application_year = excluded.application_year,
    application_month = excluded.application_month,
    application_day = excluded.application_day,
    official_year = excluded.official_year, official_month = excluded.official_month,
    official_day = excluded.official_day,
    selected_pages_json = excluded.selected_pages_json,
    checkboxes_json = excluded.checkboxes_json,
    generated_at = excluded.generated_at, updated_at = CURRENT_TIMESTAMP
`);
const listCaseContentOptions = db.prepare(`
  SELECT entity_type AS entityType, case_content AS caseContent, MAX(updated_at) AS lastUsedAt
  FROM cases
  WHERE trim(case_content) <> ''
  GROUP BY entity_type, case_content
  ORDER BY lastUsedAt DESC, case_content
`);
const listOfficialReceiptLinks = db.prepare(`
  SELECT id, case_number AS caseNumber, received_date AS receivedDate,
    official_receipt_no AS receiptNo
  FROM cases
  WHERE entity_type = ? AND tax_id = ? AND official_receipt_no <> ''
`);
const listTaxReceiptLinks = db.prepare(`
  SELECT id, case_number AS caseNumber, received_date AS receivedDate,
    tax_receipt_no AS receiptNo
  FROM cases
  WHERE tax_id = ? AND tax_receipt_no <> ''
`);

const insertColumns = [
  "case_number", "received_date", "client_name", "company_name", "tax_id", "entity_type",
  "precheck_no", "case_type", "case_content", "status", "status_detail", "notes",
  "representative", "address", "capital", "authority", "official_receipt_no", "progress_url",
  "reg_unit_code", "submitted_date", "tax_office_required", "tax_bureau_code", "billing_status",
  "billing_date", "next_follow_up_date", "payment_date", "closed_date", "paid_amount",
];
const insertCase = db.prepare(`INSERT INTO cases (${insertColumns.join(", ")}) VALUES (${insertColumns.map(() => "?").join(", ")})`);
const insertEvent = db.prepare(`INSERT INTO case_events (case_id, event_date, event_type, status, detail) VALUES (?, ?, ?, ?, ?)`);
const insertBillingItem = db.prepare(`INSERT INTO billing_items (case_id, item_name, amount, notes, sort_order) VALUES (?, ?, ?, ?, ?)`);

const officialQuerySessions = new Map();
const taxQuerySessions = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json; charset=utf-8",
};

class HttpError extends Error {
  constructor(status, message, code = "") { super(message); this.status = status; this.code = code; }
}

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin", "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; connect-src 'self' http://127.0.0.1:8689 http://localhost:8689; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'",
    ...extra,
  };
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, securityHeaders({
    "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body),
  }));
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw new HttpError(413, "資料內容過大");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new HttpError(400, "資料格式不正確"); }
}

function cleanText(value, maxLength = 500) { return String(value ?? "").trim().slice(0, maxLength); }

function amount(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const parsed = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000_000_000) throw new HttpError(400, "金額格式不正確");
  return Math.round(parsed);
}

function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value); }

function optionalDate(value, label) {
  const result = cleanText(value, 10);
  if (result && !validDate(result)) throw new HttpError(400, `${label}格式不正確`);
  return result;
}

function taipeiDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function progressUrl(receipt, regUnitCode = "17", entityType = "公司", agencyCode = "", subCaseNo = "") {
  if (!receipt) return "";
  if (entityType === "行號") {
    if (!agencyCode) return "https://serv.gcis.nat.gov.tw/caseSearch/list/QueryBusmCaseList/queryBusmCaseList.do";
    const businessUrl = new URL("https://serv.gcis.nat.gov.tw/caseSearch/detail/QueryBusmCaseDetail/queryBusmCaseDetail.do");
    businessUrl.searchParams.set("caseNo", receipt);
    businessUrl.searchParams.set("agency", agencyCode);
    businessUrl.searchParams.set("receiveNo", receipt);
    businessUrl.searchParams.set("subAcptNo", subCaseNo || "01");
    return businessUrl.toString();
  }
  const url = new URL("https://serv.gcis.nat.gov.tw/caseSearch/detail/QueryCsmmCaseDetail/queryCsmmCaseDetail.do");
  url.searchParams.set("rcvNo", receipt);
  url.searchParams.set("regUnitCode", regUnitCode || "17");
  url.searchParams.set("showPreRegNo", "0");
  return url.toString();
}

function rocDateToIso(value) {
  const text = cleanText(value, 30);
  const match = text.match(/^(\d{2,3})[/.\-](\d{1,2})[/.\-](\d{1,2})/)
    || text.match(/^(\d{2,3})年(\d{1,2})月(\d{1,2})日/)
    || text.match(/^(\d{2,3})(\d{2})(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]) + 1911;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const result = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validDate(result) ? result : "";
}

function casePayload(input, { backfill = false } = {}) {
  const entityType = cleanText(input.entityType, 10) || "公司";
  const status = cleanText(input.status, 30) || "準備中";
  const taxOfficeRequired = cleanText(input.taxOfficeRequired, 10) || "未確認";
  const inferredTaxBureau = inferTaxBureau(input.address);
  const taxBureauCode = cleanText(input.taxBureauCode, 3).toUpperCase() || inferredTaxBureau?.bureauCode || "";
  const regUnitCode = cleanText(input.regUnitCode, 10) || "17";
  const officialReceiptNo = cleanText(input.officialReceiptNo, 50);
  const payload = {
    receivedDate: cleanText(input.receivedDate, 10) || taipeiDate(), clientName: cleanText(input.clientName, 100),
    companyName: cleanText(input.companyName, 200), taxId: cleanText(input.taxId, 8), entityType,
    precheckNo: cleanText(input.precheckNo, 50), caseType: cleanText(input.caseType, 50),
    caseContent: cleanText(input.caseContent, 500), status,
    statusDetail: cleanText(input.statusDetail, 500) || (status === "準備中" ? "等待客戶提供資料" : ""),
    notes: cleanText(input.notes, 3000), representative: cleanText(input.representative, 100),
    address: cleanText(input.address, 300), capital: amount(input.capital), authority: cleanText(input.authority, 100),
    officialReceiptNo, regUnitCode, progressUrl: progressUrl(officialReceiptNo, regUnitCode, entityType),
    submittedDate: optionalDate(input.submittedDate, "送件日期"), taxOfficeRequired, taxBureauCode,
    billingStatus: billingStatuses.has(input.billingStatus) ? input.billingStatus : "未請款",
    billingDate: optionalDate(input.billingDate, "請款日期"),
    nextFollowUpDate: optionalDate(input.nextFollowUpDate, "下次追蹤日期"),
    paymentDate: optionalDate(input.paymentDate, "收款日期"), closedDate: optionalDate(input.closedDate, "結案日期"),
    paidAmount: amount(input.paidAmount),
  };

  if (!validDate(payload.receivedDate)) throw new HttpError(400, "請填寫收件日期");
  if (payload.taxId && !/^\d{8}$/.test(payload.taxId)) throw new HttpError(400, "統一編號需為 8 碼數字；新設立案件可留白");
  if (!entityTypes.has(payload.entityType)) throw new HttpError(400, "請選擇公司或行號");
  if (!payload.companyName) throw new HttpError(400, "請填寫公司／行號名稱");
  if (!payload.caseType) throw new HttpError(400, "請選擇案件種類");
  if (!payload.caseContent) throw new HttpError(400, "請填寫辦理內容");
  if (!statuses.has(payload.status)) throw new HttpError(400, "案件狀態不正確");
  if (!taxOfficeValues.has(payload.taxOfficeRequired)) throw new HttpError(400, "國稅局狀態不正確");
  if (payload.taxBureauCode && !taxBureauCodes.has(payload.taxBureauCode)) throw new HttpError(400, "請選擇正確的國稅局");
  if (!backfill && payload.status === "準備中" && !payload.statusDetail) payload.statusDetail = "等待客戶提供資料";
  return payload;
}

function cleanStringArray(value, maxItems = 200, maxLength = 300) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => cleanText(item, maxLength)).filter(Boolean);
}

function cleanShareholders(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((item) => ({
    key: cleanText(item?.key, 100) || randomUUID(),
    name: cleanText(item?.name, 100),
    nationalId: cleanText(item?.nationalId, 10).toUpperCase(),
    birthDate: cleanText(item?.birthDate, 30),
    address: cleanText(item?.address, 300),
    postalCode: cleanText(item?.postalCode, 10),
    capital: cleanText(item?.capital, 30),
  }));
}

function preparationPayload(input) {
  const nationalId = cleanText(input.nationalId, 10).toUpperCase();
  if (nationalId && !/^[A-Z][12]\d{8}$/.test(nationalId)) {
    throw new HttpError(400, "身分證字號格式不正確");
  }
  return {
    company: cleanText(input.company, 200),
    representative: cleanText(input.representative, 100),
    nationalId,
    birthDate: cleanText(input.birthDate, 30),
    precheck: cleanText(input.precheck, 50),
    approval: cleanText(input.approval, 30),
    expiry: cleanText(input.expiry, 30),
    contactAddress: cleanText(input.contactAddress, 300),
    registrationAddress: cleanText(input.registrationAddress, 300),
    contactPhone: cleanText(input.contactPhone, 50),
    registrationPostalCode: cleanText(input.registrationPostalCode, 10),
    contactPostalCode: cleanText(input.contactPostalCode, 10),
    capital: cleanText(input.capital, 30),
    representativeCapital: cleanText(input.representativeCapital, 30),
    business: cleanStringArray(input.business),
    shareholders: cleanShareholders(input.shareholders),
  };
}

function parseStoredArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStoredObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function preparationForCase(id, item = getCase.get(id)) {
  if (!item) return null;
  const stored = getPreparation.get(id);
  return {
    company: item.companyName || "",
    representative: stored?.representative || item.representative || "",
    nationalId: stored?.nationalId || "",
    birthDate: stored?.birthDate || "",
    precheck: stored?.precheck || item.precheckNo || "",
    approval: stored?.approval || "",
    expiry: stored?.expiry || "",
    contactAddress: stored?.contactAddress || "",
    registrationAddress: stored?.registrationAddress || item.address || "",
    contactPhone: stored?.contactPhone || "",
    registrationPostalCode: stored?.registrationPostalCode || "",
    contactPostalCode: stored?.contactPostalCode || "",
    capital: stored?.capital || (item.capital ? String(item.capital) : ""),
    representativeCapital: stored?.representativeCapital || "",
    business: parseStoredArray(stored?.businessJson),
    shareholders: parseStoredArray(stored?.shareholdersJson),
    updatedAt: stored?.updatedAt || "",
  };
}

function accountingOfficePayload(input) {
  const qualificationType = cleanText(input.qualificationType, 20) || "bookkeeper";
  const unifiedNumber = cleanText(input.unifiedNumber, 8);
  const responsiblePersonId = cleanText(input.responsiblePersonId, 10).toUpperCase();
  if (!officeQualificationTypes.has(qualificationType)) throw new HttpError(400, "請選擇正確的專業資格");
  if (unifiedNumber && !/^\d{8}$/.test(unifiedNumber)) throw new HttpError(400, "事務所統一編號需為 8 碼數字");
  if (responsiblePersonId && !/^[A-Z][12]\d{8}$/.test(responsiblePersonId)) throw new HttpError(400, "事務所負責人身分證字號格式不正確");
  const payload = {
    name: cleanText(input.name, 200), shortName: cleanText(input.shortName, 100), unifiedNumber,
    responsiblePerson: cleanText(input.responsiblePerson, 100), responsiblePersonId,
    address: cleanText(input.address, 300), phone: cleanText(input.phone, 50),
    email: cleanText(input.email, 200), qualificationType,
    mediaCode: cleanText(input.mediaCode, 30), licenseNumber: cleanText(input.licenseNumber, 60),
    isDefault: input.isDefault === true, active: input.active !== false,
  };
  if (!payload.name) throw new HttpError(400, "請填寫事務所名稱");
  return payload;
}

function accountingOfficeForClient(row) {
  return row ? { ...row, isDefault: Boolean(row.isDefault), active: Boolean(row.active) } : null;
}

function requireAccountingOffice(id, label = "事務所") {
  const office = getAccountingOffice.get(id);
  if (!office) throw new HttpError(400, `找不到所選${label}`);
  return accountingOfficeForClient(office);
}

function validateOfficeForPurchaseProof(office, label) {
  const missing = [
    ["unifiedNumber", "統一編號"], ["responsiblePerson", "負責人"],
    ["responsiblePersonId", "負責人身分證字號"], ["address", "地址"],
    ["phone", "電話"], ["mediaCode", "媒體代號"], ["licenseNumber", "證書字號"],
  ].filter(([key]) => !cleanText(office[key], 500)).map(([, name]) => name);
  if (missing.length) throw new HttpError(400, `${label}尚缺：${missing.join("、")}`);
}

const defaultPurchaseProofCheckboxes = Object.freeze({
  page1: {
    registration: { establishment: true, change: false, other: false },
    reason: { new: true, change: false, lost: false, damaged: false, other: false },
    attachments: { responsibleIdOriginal: false, agentPickup: true },
    relation: { responsible: false, agent: false, employee: false, otherOffice: true },
    invoiceTypes: { twoCopy: true, threeCopy: true, twoCopyRegister: false, threeCopyRegister: false, special: false },
  },
  page2: {
    services: { purchase: true, receiveCertificate: true },
    qualification: { accountant: false, bookkeeper: true, taxAgent: false },
    actions: { purchase: true, receiveCertificate: true },
  },
});

function rocDateParts(isoDate = "") {
  const match = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? { year: String(Number(match[1]) - 1911), month: String(Number(match[2])), day: String(Number(match[3])) }
    : { year: "", month: "", day: "" };
}

function defaultPurchaseDate() {
  const [year, month] = taipeiDate().split("-").map(Number);
  return { year: String(year - 1911), month: String(month), day: "" };
}

function rocPart(value, label, { min, max, required = false }) {
  const text = cleanText(value, 3);
  if (!text && !required) return "";
  if (!/^\d{1,3}$/.test(text) || Number(text) < min || Number(text) > max) {
    throw new HttpError(400, `${label}格式不正確`);
  }
  return String(Number(text));
}

function purchaseProofPayload(input, current, stored = null) {
  const defaults = defaultPurchaseDate();
  const officeId = Number(input.officeId ?? stored?.officeId ?? 0);
  const page4OfficeId = Number(input.page4OfficeId ?? stored?.page4OfficeId ?? officeId);
  const selectedPages = [...new Set((Array.isArray(input.selectedPages) ? input.selectedPages : [1, 2, 3, 4]).map(Number))]
    .filter((page) => Number.isInteger(page) && page >= 1 && page <= 4).sort((a, b) => a - b);
  if (!selectedPages.length) throw new HttpError(400, "請至少選擇一頁購票證明申請書");
  const checkboxes = input.checkboxes && typeof input.checkboxes === "object" && !Array.isArray(input.checkboxes)
    ? input.checkboxes : defaultPurchaseProofCheckboxes;
  const payload = {
    officeId, page4OfficeId,
    taxRegistrationNumber: cleanText(input.taxRegistrationNumber ?? stored?.taxRegistrationNumber, 20),
    responsiblePersonId: cleanText(input.responsiblePersonId ?? stored?.responsiblePersonId, 10).toUpperCase(),
    businessPhone: cleanText(input.businessPhone ?? stored?.businessPhone, 50),
    email: cleanText(input.email ?? stored?.email, 200),
    taxBureauName: cleanText(input.taxBureauName ?? stored?.taxBureauName ?? taxBureaus[current.taxBureauCode]?.shortName, 20).replace(/^臺北$/, "台北"),
    branchName: cleanText(input.branchName ?? stored?.branchName, 100),
    salesDocumentNumber: cleanText(input.salesDocumentNumber ?? stored?.salesDocumentNumber, 100),
    applicationDate: {
      year: rocPart(input.applicationDate?.year ?? stored?.applicationYear ?? defaults.year, "申請年份", { min: 1, max: 999, required: true }),
      month: rocPart(input.applicationDate?.month ?? stored?.applicationMonth ?? defaults.month, "申請月份", { min: 1, max: 12 }),
      day: rocPart(input.applicationDate?.day ?? stored?.applicationDay, "申請日期", { min: 1, max: 31 }),
    },
    officialDate: {
      year: rocPart(input.officialDate?.year ?? stored?.officialYear, "公文年份", { min: 1, max: 999 }),
      month: rocPart(input.officialDate?.month ?? stored?.officialMonth, "公文月份", { min: 1, max: 12 }),
      day: rocPart(input.officialDate?.day ?? stored?.officialDay, "公文日期", { min: 1, max: 31 }),
    },
    selectedPages, checkboxes,
  };
  if (!Number.isInteger(officeId) || officeId < 1) throw new HttpError(400, "請選擇受任事務所");
  if (!Number.isInteger(page4OfficeId) || page4OfficeId < 1) throw new HttpError(400, "請選擇第 4 頁的專業代理人事務所");
  if (payload.responsiblePersonId && !/^[A-Z][12]\d{8}$/.test(payload.responsiblePersonId)) throw new HttpError(400, "負責人身分證字號格式不正確");
  if (!payload.taxBureauName) throw new HttpError(400, "請選擇國稅局");
  if (!payload.branchName) throw new HttpError(400, "請填寫分局／稽徵所名稱");
  return payload;
}

function purchaseProofForCase(id, item = getCase.get(id)) {
  if (!item) return null;
  const stored = getPurchaseProof.get(id);
  const preparation = preparationForCase(id, item);
  const nationalTax = getApprovalDocuments.all(id).find((row) => row.agency === "national_tax");
  const official = rocDateParts(nationalTax?.approvalDate || "");
  const application = defaultPurchaseDate();
  const defaultOffice = listAccountingOffices.all().find((office) => Boolean(office.active) && Boolean(office.isDefault));
  const businessAddress = preparation?.registrationAddress || item.address || "";
  const jurisdiction = inferTaxJurisdiction(businessAddress);
  return {
    case: {
      id: item.id, caseNumber: item.caseNumber, companyName: item.companyName,
      taxId: item.taxId, representative: preparation?.representative || item.representative || "",
      address: businessAddress,
    },
    settings: {
      officeId: stored?.officeId || defaultOffice?.id || null,
      page4OfficeId: stored?.page4OfficeId || stored?.officeId || defaultOffice?.id || null,
      taxRegistrationNumber: stored?.taxRegistrationNumber || "",
      responsiblePersonId: stored?.responsiblePersonId || preparation?.nationalId || "",
      businessPhone: stored?.businessPhone || preparation?.contactPhone || "",
      email: stored?.email || "",
      taxBureauName: stored?.taxBureauName || jurisdiction?.bureauShortName || taxBureaus[item.taxBureauCode]?.shortName?.replace(/^臺北$/, "台北") || "",
      branchName: stored?.branchName || jurisdiction?.branchName || "",
      salesDocumentNumber: stored?.salesDocumentNumber || "",
      applicationDate: {
        year: stored?.applicationYear || application.year,
        month: stored?.applicationMonth || application.month,
        day: stored?.applicationDay || application.day,
      },
      officialDate: {
        year: stored?.officialYear || official.year,
        month: stored?.officialMonth || official.month,
        day: stored?.officialDay || official.day,
      },
      selectedPages: stored ? parseStoredArray(stored.selectedPagesJson) : [1, 2, 3, 4],
      checkboxes: stored ? parseStoredObject(stored.checkboxesJson) : defaultPurchaseProofCheckboxes,
      generatedAt: stored?.generatedAt || "", updatedAt: stored?.updatedAt || "",
    },
    suggestedJurisdiction: jurisdiction,
    nationalTaxApprovalReceived: ["received", "archived"].includes(nationalTax?.status),
  };
}

function savePurchaseProof(id, payload, generatedAt = "") {
  upsertPurchaseProof.run(
    id, payload.officeId, payload.page4OfficeId, payload.taxRegistrationNumber,
    payload.responsiblePersonId, payload.businessPhone, payload.email,
    payload.taxBureauName, payload.branchName, payload.salesDocumentNumber,
    payload.applicationDate.year, payload.applicationDate.month, payload.applicationDate.day,
    payload.officialDate.year, payload.officialDate.month, payload.officialDate.day,
    JSON.stringify(payload.selectedPages), JSON.stringify(payload.checkboxes), generatedAt,
  );
}

function approvalTracking(id) {
  const approvals = {
    city_government: {
      agency: "city_government", status: "not_received", approvalDate: null,
      documentNumber: null, cloudPath: null, updatedAt: null,
    },
    national_tax: {
      agency: "national_tax", status: "not_received", approvalDate: null,
      documentNumber: null, cloudPath: null, updatedAt: null,
    },
  };
  for (const row of getApprovalDocuments.all(id)) approvals[row.agency] = { ...approvals[row.agency], ...row };
  const card = getRegistrationCard.get(id);
  return {
    approvals,
    registrationCard: card ? {
      originalReceived: Boolean(card.originalReceived),
      customerCopySent: Boolean(card.customerCopySent),
      updatedAt: card.updatedAt,
    } : { originalReceived: false, customerCopySent: false, updatedAt: null },
  };
}

function nextCaseNumber(year) {
  const row = db.prepare("SELECT MAX(CAST(substr(case_number, 6) AS INTEGER)) AS sequence FROM cases WHERE case_number LIKE ?").get(`${year}-%`);
  return `${year}-${String(Number(row?.sequence || 0) + 1).padStart(3, "0")}`;
}

function insertValues(payload, caseNumber) {
  return [
    caseNumber, payload.receivedDate, payload.clientName, payload.companyName, payload.taxId,
    payload.entityType, payload.precheckNo, payload.caseType, payload.caseContent, payload.status,
    payload.statusDetail, payload.notes, payload.representative, payload.address, payload.capital,
    payload.authority, payload.officialReceiptNo, payload.progressUrl, payload.regUnitCode,
    payload.submittedDate, payload.taxOfficeRequired, payload.taxBureauCode, payload.billingStatus, payload.billingDate,
    payload.nextFollowUpDate, payload.paymentDate, payload.closedDate, payload.paidAmount,
  ];
}

function createCase(payload) {
  const caseNumber = nextCaseNumber(payload.receivedDate.slice(0, 4));
  const result = insertCase.run(...insertValues(payload, caseNumber));
  const id = Number(result.lastInsertRowid);
  insertEvent.run(id, payload.receivedDate, "進度", payload.status, payload.statusDetail || "建立案件");
  return id;
}

function daysBetween(from, to) {
  if (!validDate(from) || !validDate(to)) return 0;
  return Math.max(0, Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
}

function buildReminders(cases) {
  const today = taipeiDate();
  const reminders = [];
  const closedStatuses = new Set(["結案", "取消"]);
  const push = (item, kind, title, message, priority = 2) => reminders.push({
    id: `${item.id}-${kind}`, caseId: item.id, kind, title, message, priority,
    companyName: item.companyName, taxId: item.taxId, entityType: item.entityType,
    caseType: item.caseType, caseContent: item.caseContent, status: item.status,
  });

  for (const item of cases) {
    if (item.status === "補件") push(item, "supplement", "補件待處理", item.statusDetail || "請確認補件內容", 1);
    if (item.status === "可自領") push(item, "pickup", "案件可領件", "可安排前往市政府領件", 1);
    if (item.status === "已領件" && item.taxOfficeRequired === "需要") push(item, "tax", "尚待國稅局", "領件後仍需辦理國稅局", 1);
    if (item.status === "已領件" && item.taxOfficeRequired === "未確認") push(item, "tax-check", "確認國稅局流程", "請確認這件是否需要再跑國稅局", 2);

    if (!closedStatuses.has(item.status) && item.nextFollowUpDate && item.nextFollowUpDate <= today) {
      push(item, "follow-up", "已到追蹤日", `原訂 ${item.nextFollowUpDate} 追蹤`, 1);
    } else if (!closedStatuses.has(item.status) && !["補件", "可自領"].includes(item.status)) {
      const last = item.lastProgressDate || item.receivedDate;
      const staleDays = daysBetween(last, today);
      const threshold = item.status === "準備中" ? 5 : 7;
      if (staleDays >= threshold) push(item, "stale", item.status === "準備中" ? "等待客戶資料" : "進度待追蹤", `${staleDays} 天沒有更新進度`, staleDays >= 14 ? 1 : 2);
    }

    if (item.status === "結案" && item.billingStatus === "未請款") push(item, "unbilled", "結案尚未請款", "請建立收費明細並向客戶請款", 1);
    if (item.billingStatus === "已請款" && item.outstanding > 0) {
      const waited = daysBetween(item.billingDate || item.lastEventDate || item.receivedDate, today);
      if (waited >= 7) push(item, "unpaid", "請款尚未收款", `已請款 ${waited} 天，尚有 ${item.outstanding.toLocaleString("zh-TW")} 元未收`, waited >= 30 ? 1 : 2);
    }
  }
  return reminders.sort((a, b) => a.priority - b.priority || a.companyName.localeCompare(b.companyName, "zh-Hant"));
}

async function fetchRegistryData(taxId) {
  let upstream;
  try {
    upstream = await fetch(`https://company.g0v.ronny.tw/api/show/${taxId}`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000),
    });
  } catch { throw new HttpError(502, "公司資料服務目前無法連線"); }
  if (!upstream.ok) throw new HttpError(404, "查不到這個統一編號");
  const payload = await upstream.json();
  if (!payload?.data?.["公司名稱"] && !payload?.data?.["商業名稱"]) throw new HttpError(404, "查不到這個統一編號");
  return payload.data;
}

function pruneSessions(store) {
  const now = Date.now();
  for (const [id, session] of store) if (!session?.expiresAt || session.expiresAt <= now) store.delete(id);
}

function saveSession(store, value, lifetimeMs) {
  pruneSessions(store);
  const id = randomUUID();
  store.set(id, { ...value, expiresAt: Date.now() + lifetimeMs });
  return id;
}

function officialCandidatesForClient(current, candidates) {
  const links = new Map(listOfficialReceiptLinks.all(current.entityType, current.taxId)
    .map((item) => [item.receiptNo, item]));
  const targetDate = current.submittedDate || current.receivedDate;
  return candidates.map((candidate, index) => {
    const link = links.get(candidate.receiptNo);
    const receivedDateIso = rocDateToIso(candidate.receivedDate);
    return {
      index,
      receiptNo: candidate.receiptNo,
      receivedDate: candidate.receivedDate,
      receivedDateIso,
      officialStatus: candidate.officialStatus,
      appStatus: candidate.appStatus,
      authority: candidate.authority,
      subject: candidate.subject,
      progressUrl: candidate.progressUrl,
      recommended: Boolean(!link && targetDate && receivedDateIso === targetDate),
      linkedCase: link ? { id: link.id, caseNumber: link.caseNumber, receivedDate: link.receivedDate, current: link.id === current.id } : null,
    };
  });
}

function chooseOfficialCandidate(current, candidates, publicCandidates) {
  if (current.officialReceiptNo) {
    const exact = candidates.find((item) => item.receiptNo === current.officialReceiptNo);
    if (exact) return exact;
  }
  const available = candidates.filter((candidate) => {
    const publicItem = publicCandidates.find((item) => item.receiptNo === candidate.receiptNo);
    return !publicItem?.linkedCase || publicItem.linkedCase.current;
  });
  const targetDate = current.submittedDate || current.receivedDate;
  const dateMatches = targetDate
    ? available.filter((candidate) => rocDateToIso(candidate.receivedDate) === targetDate)
    : [];
  if (dateMatches.length === 1) return dateMatches[0];
  if (available.length === 1) return available[0];
  return null;
}

function applyOfficialProgress(current, official, lookupAuthority = "") {
  const linked = listOfficialReceiptLinks.all(current.entityType, current.taxId)
    .find((item) => item.receiptNo === official.receiptNo && item.id !== current.id);
  if (linked) throw new HttpError(409, `這個收文號已連結到案件 ${linked.caseNumber}`);

  const protectedStatuses = new Set(["已領件", "國稅局辦理", "結案", "取消"]);
  const nextStatus = protectedStatuses.has(current.status) ? current.status : official.appStatus;
  const officialStatus = cleanText(official.officialStatus, 100);
  const officialDetail = officialStatus.includes("發文中")
    ? `官方網站：${officialStatus}（尚未可領件）`
    : `官方網站：${officialStatus}`;
  const nextStatusDetail = protectedStatuses.has(current.status) ? current.statusDetail : officialDetail;
  const receiptNo = cleanText(official.receiptNo || current.officialReceiptNo, 50);
  const regUnitCode = cleanText(official.regUnitCode || current.regUnitCode, 10) || "17";
  const agencyCode = cleanText(official.agencyCode, 30);
  const subCaseNo = cleanText(official.subCaseNo, 20);
  const checkedAt = new Date().toISOString();
  const submittedDate = current.submittedDate || rocDateToIso(official.receivedDate) || taipeiDate();
  const authority = cleanText(official.authority || lookupAuthority || current.authority, 100);
  const finalProgressUrl = cleanText(official.progressUrl, 1000)
    || progressUrl(receiptNo, regUnitCode, current.entityType, agencyCode, subCaseNo);
  const changed = receiptNo !== current.officialReceiptNo
    || officialStatus !== current.officialStatus
    || nextStatus !== current.status;
  const changes = [];
  if (receiptNo && receiptNo !== current.officialReceiptNo) changes.push(`帶入收文號 ${receiptNo}`);
  if (officialStatus && officialStatus !== current.officialStatus) changes.push(`官方進度：${officialStatus}`);
  if (nextStatus !== current.status) changes.push(`系統進度更新為 ${nextStatus}`);

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE cases SET status = ?, status_detail = ?, official_receipt_no = ?, progress_url = ?,
        official_status = ?, official_checked_at = ?, official_agency_code = ?, official_sub_case_no = ?,
        official_received_date = ?, official_outgoing_no = ?, official_outgoing_date = ?, official_subject = ?,
        reg_unit_code = ?, submitted_date = ?, authority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(nextStatus, nextStatusDetail, receiptNo, finalProgressUrl,
      officialStatus, checkedAt, agencyCode, subCaseNo,
      cleanText(official.receivedDate, 30), cleanText(official.outgoingNo, 100),
      cleanText(official.outgoingDate, 30), cleanText(official.subject, 1000),
      regUnitCode, submittedDate, authority, current.id);
    if (changed) insertEvent.run(current.id, taipeiDate(), "官方查詢", nextStatus, changes.join("；") || officialDetail);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }

  return {
    changed,
    case: getCase.get(current.id),
    official: { receiptNo, status: officialStatus, checkedAt, progressUrl: finalProgressUrl },
    events: getEvents.all(current.id),
  };
}

function taxCandidatesForClient(current, candidates) {
  const links = new Map(listTaxReceiptLinks.all(current.taxId).map((item) => [item.receiptNo, item]));
  return candidates.map((candidate, index) => {
    const link = links.get(candidate.receiptNo);
    return {
      index,
      ...candidate,
      linkedCase: link ? { id: link.id, caseNumber: link.caseNumber, receivedDate: link.receivedDate, current: link.id === current.id } : null,
    };
  });
}

function applyTaxProgress(current, official) {
  const linked = listTaxReceiptLinks.all(current.taxId)
    .find((item) => item.receiptNo === official.receiptNo && item.id !== current.id);
  if (linked) throw new HttpError(409, `這個國稅局文號已連結到案件 ${linked.caseNumber}`);
  const bureauCode = cleanText(official.bureauCode, 3).toUpperCase();
  if (!taxBureauCodes.has(bureauCode)) throw new HttpError(400, "國稅局資料格式不正確");
  const officialStatus = cleanText(official.officialStatus, 100);
  const completed = /已發文|結案|完成/.test(officialStatus);
  const taxOfficeRequired = completed ? "已完成" : "辦理中";
  const checkedAt = new Date().toISOString();
  const label = completed ? "國稅局已完成" : "國稅局辦理中";
  const detail = `${taxBureaus[bureauCode].shortName}・${official.receiptNo || "無文號"}・${official.caseType || "稅籍登記"}・${officialStatus || "已查詢"}`;
  const duplicateEvent = findMatchingTaxEvent.get(current.id, label, detail);

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE cases SET tax_office_required = ?, tax_bureau_code = ?, tax_receipt_no = ?,
        tax_received_date = ?, tax_case_type = ?, tax_official_status = ?, tax_checked_at = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(taxOfficeRequired, bureauCode, cleanText(official.receiptNo, 100),
      cleanText(official.receivedDate, 30), cleanText(official.caseType, 200), officialStatus, checkedAt, current.id);
    if (!duplicateEvent) {
      insertEvent.run(current.id, rocDateToIso(official.receivedDate) || taipeiDate(), "國稅局查詢", label, detail);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return {
    changed: !duplicateEvent,
    duplicatePrevented: Boolean(duplicateEvent),
    case: getCase.get(current.id),
    events: getEvents.all(current.id),
    official: { ...official, checkedAt },
  };
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, port, database: basename(databasePath), date: taipeiDate() });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/accounting-offices") {
    sendJson(response, 200, { ok: true, offices: listAccountingOffices.all().map(accountingOfficeForClient) });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/accounting-offices") {
    const payload = accountingOfficePayload(await readJson(request));
    db.exec("BEGIN IMMEDIATE");
    try {
      if (payload.isDefault) db.prepare("UPDATE accounting_offices SET is_default = 0").run();
      const result = insertAccountingOffice.run(
        payload.name, payload.shortName, payload.unifiedNumber, payload.responsiblePerson,
        payload.responsiblePersonId, payload.address, payload.phone, payload.email,
        payload.qualificationType, payload.mediaCode, payload.licenseNumber,
        payload.isDefault ? 1 : 0, payload.active ? 1 : 0,
      );
      db.exec("COMMIT");
      sendJson(response, 201, { ok: true, office: accountingOfficeForClient(getAccountingOffice.get(Number(result.lastInsertRowid))) });
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return true;
  }
  const accountingOfficeMatch = url.pathname.match(/^\/api\/accounting-offices\/(\d+)$/);
  if (request.method === "PUT" && accountingOfficeMatch) {
    const id = Number(accountingOfficeMatch[1]);
    if (!getAccountingOffice.get(id)) throw new HttpError(404, "找不到這間事務所");
    const payload = accountingOfficePayload(await readJson(request));
    db.exec("BEGIN IMMEDIATE");
    try {
      if (payload.isDefault) db.prepare("UPDATE accounting_offices SET is_default = 0 WHERE id <> ?").run(id);
      updateAccountingOffice.run(
        payload.name, payload.shortName, payload.unifiedNumber, payload.responsiblePerson,
        payload.responsiblePersonId, payload.address, payload.phone, payload.email,
        payload.qualificationType, payload.mediaCode, payload.licenseNumber,
        payload.isDefault ? 1 : 0, payload.active ? 1 : 0, id,
      );
      db.exec("COMMIT");
      sendJson(response, 200, { ok: true, office: accountingOfficeForClient(getAccountingOffice.get(id)) });
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/cases") {
    const year = url.searchParams.get("year") || taipeiDate().slice(0, 4);
    if (!/^\d{4}$/.test(year)) throw new HttpError(400, "年度格式不正確");
    sendJson(response, 200, { ok: true, cases: listCasesByYear.all(year) });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/case-content-options") {
    sendJson(response, 200, { ok: true, options: listCaseContentOptions.all() });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/api/reminders") {
    sendJson(response, 200, { ok: true, reminders: buildReminders(listAllCases.all()) });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/cases") {
    const payload = casePayload(await readJson(request));
    db.exec("BEGIN IMMEDIATE");
    try {
      const id = createCase(payload);
      db.exec("COMMIT");
      sendJson(response, 201, { ok: true, case: getCase.get(id) });
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return true;
  }
  if (request.method === "POST" && url.pathname === "/api/cases/batch") {
    const input = await readJson(request);
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) throw new HttpError(400, "請提供 1 至 100 筆案件");
    const payloads = input.items.map((item, index) => {
      try { return casePayload(item, { backfill: true }); }
      catch (error) { throw new HttpError(error.status || 400, `第 ${index + 1} 筆：${error.message}`); }
    });
    const ids = [];
    db.exec("BEGIN IMMEDIATE");
    try { for (const payload of payloads) ids.push(createCase(payload)); db.exec("COMMIT"); }
    catch (error) { db.exec("ROLLBACK"); throw error; }
    sendJson(response, 201, { ok: true, count: ids.length, cases: ids.map((id) => getCase.get(id)) });
    return true;
  }

  const caseMatch = url.pathname.match(/^\/api\/cases\/(\d+)$/);
  if (request.method === "GET" && caseMatch) {
    const id = Number(caseMatch[1]);
    const item = getCase.get(id);
    if (!item) throw new HttpError(404, "找不到這筆案件");
    sendJson(response, 200, { ok: true, case: item, events: getEvents.all(id), billingItems: getBillingItems.all(id) });
    return true;
  }
  if (request.method === "PUT" && caseMatch) {
    const id = Number(caseMatch[1]);
    const current = getCase.get(id);
    if (!current) throw new HttpError(404, "找不到這筆案件");
    const input = await readJson(request);
    const payload = casePayload({ ...current, ...input, status: current.status, statusDetail: current.statusDetail });
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        UPDATE cases SET received_date = ?, client_name = ?, company_name = ?, tax_id = ?, entity_type = ?,
          precheck_no = ?, case_type = ?, case_content = ?, notes = ?, representative = ?, address = ?,
          capital = ?, authority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(payload.receivedDate, payload.clientName, payload.companyName, payload.taxId, payload.entityType,
        payload.precheckNo, payload.caseType, payload.caseContent, payload.notes, payload.representative,
        payload.address, payload.capital, payload.authority, id);
      if (payload.receivedDate !== current.receivedDate) {
        db.prepare(`UPDATE case_events SET event_date = ? WHERE id = (
          SELECT id FROM case_events WHERE case_id = ? ORDER BY id ASC LIMIT 1
        )`).run(payload.receivedDate, id);
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    sendJson(response, 200, { ok: true, case: getCase.get(id) });
    return true;
  }

  const preparationMatch = url.pathname.match(/^\/api\/cases\/(\d+)\/preparation$/);
  if (request.method === "GET" && preparationMatch) {
    const id = Number(preparationMatch[1]);
    const item = getCase.get(id);
    if (!item) throw new HttpError(404, "找不到這筆案件");
    sendJson(response, 200, { ok: true, preparation: preparationForCase(id, item) });
    return true;
  }
  if (request.method === "PUT" && preparationMatch) {
    const id = Number(preparationMatch[1]);
    const current = getCase.get(id);
    if (!current) throw new HttpError(404, "找不到這筆案件");
    const payload = preparationPayload(await readJson(request));
    db.exec("BEGIN IMMEDIATE");
    try {
      upsertPreparation.run(
        id, payload.representative, payload.nationalId, payload.birthDate,
        payload.precheck, payload.approval, payload.expiry, payload.contactAddress,
        payload.registrationAddress, payload.contactPhone,
        payload.registrationPostalCode, payload.contactPostalCode, payload.capital,
        payload.representativeCapital, JSON.stringify(payload.business),
        JSON.stringify(payload.shareholders),
      );
      db.prepare(`
        UPDATE cases SET company_name = ?, representative = ?, precheck_no = ?,
          address = ?, capital = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(payload.company || current.companyName, payload.representative,
        payload.precheck, payload.registrationAddress, amount(payload.capital), id);
      insertEvent.run(id, taipeiDate(), "資料準備", current.status, "已儲存 OCR 與文件準備確認資料");
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    sendJson(response, 200, {
      ok: true,
      case: getCase.get(id),
      preparation: preparationForCase(id),
    });
    return true;
  }

  const approvalsMatch = url.pathname.match(/^\/api\/cases\/(\d+)\/approvals$/);
  if (request.method === "GET" && approvalsMatch) {
    const id = Number(approvalsMatch[1]);
    if (!getCase.get(id)) throw new HttpError(404, "找不到這筆案件");
    sendJson(response, 200, approvalTracking(id));
    return true;
  }
  if (["PATCH", "PUT"].includes(request.method) && approvalsMatch) {
    const id = Number(approvalsMatch[1]);
    const current = getCase.get(id);
    if (!current) throw new HttpError(404, "找不到這筆案件");
    const input = await readJson(request);
    const approvals = input?.approvals;
    const card = input?.registrationCard;
    if (!approvals || !card) throw new HttpError(400, "核准公文資料格式不正確");
    const agencies = ["city_government", "national_tax"];
    const rows = agencies.map((agency) => {
      const item = approvals[agency];
      if (!item || !approvalStatuses.has(item.status)) throw new HttpError(400, "公文狀態不正確");
      return {
        agency,
        status: item.status,
        approvalDate: optionalDate(item.approvalDate, "核准日期") || null,
        documentNumber: cleanText(item.documentNumber, 120) || null,
        cloudPath: cleanText(item.cloudPath, 500) || null,
      };
    });
    if (typeof card.originalReceived !== "boolean" || typeof card.customerCopySent !== "boolean") {
      throw new HttpError(400, "登記事項卡狀態格式不正確");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      rows.forEach((item) => upsertApprovalDocument.run(
        id, item.agency, item.status, item.approvalDate,
        item.documentNumber, item.cloudPath,
      ));
      upsertRegistrationCard.run(id, card.originalReceived ? 1 : 0, card.customerCopySent ? 1 : 0);
      db.prepare("UPDATE cases SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      insertEvent.run(id, taipeiDate(), "核准公文", current.status, "已更新核准公文與登記事項卡追蹤");
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    sendJson(response, 200, { ok: true, ...approvalTracking(id) });
    return true;
  }
  if (request.method === "DELETE" && caseMatch) {
    const id = Number(caseMatch[1]);
    const current = getCase.get(id);
    if (!current) throw new HttpError(404, "找不到這筆案件");
    db.exec("BEGIN IMMEDIATE");
    try {
      deleteCase.run(id);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    for (const sessions of [officialQuerySessions, taxQuerySessions]) {
      for (const [sessionId, session] of sessions) if (session?.caseId === id) sessions.delete(sessionId);
    }
    sendJson(response, 200, { ok: true, deletedCase: { id, caseNumber: current.caseNumber, companyName: current.companyName } });
    return true;
  }

  const purchaseProofMatch = url.pathname.match(/^\/api\/cases\/(\d+)\/purchase-proof$/);
  if (request.method === "GET" && purchaseProofMatch) {
    const id = Number(purchaseProofMatch[1]);
    const current = getCase.get(id);
    if (!current) throw new HttpError(404, "找不到這筆案件");
    sendJson(response, 200, {
      ok: true,
      ...purchaseProofForCase(id, current),
      offices: listAccountingOffices.all().map(accountingOfficeForClient),
    });
    return true;
  }
  if (request.method === "PUT" && purchaseProofMatch) {
    const id = Number(purchaseProofMatch[1]);
    const current = getCase.get(id);
    if (!current) throw new HttpError(404, "找不到這筆案件");
    const stored = getPurchaseProof.get(id);
    const payload = purchaseProofPayload(await readJson(request), current, stored);
    requireAccountingOffice(payload.officeId, "受任事務所");
    requireAccountingOffice(payload.page4OfficeId, "第 4 頁事務所");
    savePurchaseProof(id, payload, stored?.generatedAt || "");
    sendJson(response, 200, { ok: true, ...purchaseProofForCase(id, current) });
    return true;
  }

  const purchaseProofDocxMatch = url.pathname.match(/^\/api\/cases\/(\d+)\/purchase-proof\/docx$/);
  if (request.method === "POST" && purchaseProofDocxMatch) {
    const id = Number(purchaseProofDocxMatch[1]);
    const current = getCase.get(id);
    if (!current) throw new HttpError(404, "找不到這筆案件");
    const tracking = purchaseProofForCase(id, current);
    if (!tracking.nationalTaxApprovalReceived) {
      throw new HttpError(409, "請先將國稅局核准公文標記為已收到或已歸檔");
    }
    if (!/^\d{8}$/.test(current.taxId || "")) throw new HttpError(400, "案件尚未填寫 8 碼統一編號");
    const stored = getPurchaseProof.get(id);
    const payload = purchaseProofPayload(await readJson(request), current, stored);
    const office = requireAccountingOffice(payload.officeId, "受任事務所");
    const page4Office = requireAccountingOffice(payload.page4OfficeId, "第 4 頁事務所");
    validateOfficeForPurchaseProof(office, "受任事務所");
    validateOfficeForPurchaseProof(page4Office, "第 4 頁事務所");
    if (!current.companyName || !current.representative || !current.address) {
      throw new HttpError(400, "案件尚缺公司名稱、負責人或營業地址，請先補齊案件／資料準備內容");
    }
    if (!payload.taxRegistrationNumber) throw new HttpError(400, "請填寫稅籍編號");
    if (!payload.responsiblePersonId) throw new HttpError(400, "請填寫公司負責人身分證字號");
    const checkboxes = JSON.parse(JSON.stringify(payload.checkboxes || {}));
    checkboxes.page2 ||= {};
    checkboxes.page2.qualification = {
      accountant: office.qualificationType === "accountant",
      bookkeeper: office.qualificationType === "bookkeeper",
      taxAgent: office.qualificationType === "tax_agent",
    };
    const generatedAt = new Date().toISOString();
    const buffer = await generatePurchaseProofDocx({
      request: { ...payload, checkboxes },
      customer: {
        unifiedNumber: current.taxId,
        taxRegistrationNumber: payload.taxRegistrationNumber,
        companyName: current.companyName,
        responsiblePerson: current.representative,
        responsiblePersonId: payload.responsiblePersonId,
        address: current.address,
        phone: payload.businessPhone,
        email: payload.email,
      },
      office,
      page4Office,
    });
    db.exec("BEGIN IMMEDIATE");
    try {
      savePurchaseProof(id, { ...payload, checkboxes }, generatedAt);
      insertEvent.run(id, taipeiDate(), "購票證明", current.status, `已產生購票證明申請 Word（${payload.selectedPages.length} 頁）`);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    const safeCaseNumber = current.caseNumber.replace(/[^0-9A-Za-z_-]/g, "_");
    const fileName = `購票證明申請-${current.companyName}.docx`;
    response.writeHead(200, securityHeaders({
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="purchase-proof-${safeCaseNumber}.docx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": String(buffer.length),
    }));
    response.end(buffer);
    return true;
  }

  const eventDeleteMatch = url.pathname.match(/^\/api\/cases\/(\d+)\/events\/(\d+)$/);
  if (request.method === "DELETE" && eventDeleteMatch) {
    const caseId = Number(eventDeleteMatch[1]);
    const eventId = Number(eventDeleteMatch[2]);
    if (!getCase.get(caseId)) throw new HttpError(404, "找不到這筆案件");
    const result = deleteCaseEvent.run(eventId, caseId);
    if (!result.changes) throw new HttpError(404, "找不到這筆案件歷程");
    db.prepare("UPDATE cases SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(caseId);
    sendJson(response, 200, { ok: true, deletedEventId: eventId, events: getEvents.all(caseId) });
    return true;
  }

  const eventMatch = url.pathname.match(/^\/api\/cases\/(\d+)\/events$/);
  if (request.method === "POST" && eventMatch) {
    const id = Number(eventMatch[1]);
    const current = getCase.get(id);
    if (!current) throw new HttpError(404, "找不到這筆案件");
    const input = await readJson(request);
    const status = cleanText(input.status, 30);
    const detail = cleanText(input.detail, 1000);
    const eventDate = optionalDate(input.eventDate || taipeiDate(), "更新日期");
    const receivedDateAdjusted = eventDate < current.receivedDate;
    const receivedDate = receivedDateAdjusted ? eventDate : current.receivedDate;
    if (!statuses.has(status)) throw new HttpError(400, "請選擇目前進度");
    const officialReceiptNo = cleanText(input.officialReceiptNo ?? current.officialReceiptNo, 50);
    const regUnitCode = cleanText(input.regUnitCode ?? current.regUnitCode, 10) || "17";
    let submittedDate = optionalDate(input.submittedDate ?? current.submittedDate, "送件日期");
    let closedDate = current.closedDate;
    if (status === "已送件" && !submittedDate) submittedDate = eventDate;
    if (status === "結案" && !closedDate) closedDate = eventDate;
    const taxOfficeRequired = cleanText(input.taxOfficeRequired ?? current.taxOfficeRequired, 10) || "未確認";
    if (!taxOfficeValues.has(taxOfficeRequired)) throw new HttpError(400, "國稅局狀態不正確");
    const taxBureauCode = cleanText(input.taxBureauCode ?? current.taxBureauCode, 3).toUpperCase();
    if (taxBureauCode && !taxBureauCodes.has(taxBureauCode)) throw new HttpError(400, "請選擇正確的國稅局");
    const nextFollowUpDate = optionalDate(input.nextFollowUpDate ?? current.nextFollowUpDate, "下次追蹤日期");
    const taxOfficeChanged = taxOfficeRequired !== current.taxOfficeRequired || taxBureauCode !== (current.taxBureauCode || "");
    const progressChanged = status !== current.status || detail !== (current.statusDetail || "")
      || officialReceiptNo !== (current.officialReceiptNo || "") || regUnitCode !== (current.regUnitCode || "17")
      || submittedDate !== (current.submittedDate || "") || nextFollowUpDate !== (current.nextFollowUpDate || "");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`
        UPDATE cases SET received_date = ?, status = ?, status_detail = ?, official_receipt_no = ?, progress_url = ?,
          reg_unit_code = ?, submitted_date = ?, tax_office_required = ?, tax_bureau_code = ?, next_follow_up_date = ?,
          closed_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(receivedDate, status, detail, officialReceiptNo, progressUrl(officialReceiptNo, regUnitCode, current.entityType,
        current.officialAgencyCode, current.officialSubCaseNo), regUnitCode,
        submittedDate, taxOfficeRequired, taxBureauCode, nextFollowUpDate, closedDate, id);
      if (receivedDateAdjusted) {
        db.prepare(`UPDATE case_events SET event_date = ? WHERE id = (
          SELECT id FROM case_events WHERE case_id = ? ORDER BY id ASC LIMIT 1
        )`).run(receivedDate, id);
      }
      const taxLabels = { 未確認: "尚未確認", 需要: "待辦國稅局", 辦理中: "國稅局辦理中", 不需要: "免送國稅局", 已完成: "國稅局已完成" };
      const taxOnly = taxOfficeChanged && !progressChanged;
      const bureauLabel = taxBureauCode ? taxBureaus[taxBureauCode].shortName : "未選擇區局";
      insertEvent.run(id, eventDate, taxOnly ? "國稅局" : "進度",
        taxOnly ? taxLabels[taxOfficeRequired] : status,
        taxOnly ? `國稅局進度更新為「${taxLabels[taxOfficeRequired]}」・${bureauLabel}` : detail);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    sendJson(response, 201, { ok: true, case: getCase.get(id), events: getEvents.all(id), receivedDateAdjusted, taxOfficeChanged });
    return true;
  }

  const officialMatch = url.pathname.match(/^\/api\/cases\/(\d+)\/check-progress$/);
  if (request.method === "POST" && officialMatch) {
    const id = Number(officialMatch[1]);
    let current = getCase.get(id);
    if (!current) throw new HttpError(404, "找不到這筆案件");
    if (!/^\d{8}$/.test(current.taxId || "")) {
      throw new HttpError(400, "這筆案件沒有統編；新設立案件請先在「更新進度」登記收文號");
    }
    const input = await readJson(request);

    if (input.querySessionId) {
      pruneSessions(officialQuerySessions);
      const session = officialQuerySessions.get(cleanText(input.querySessionId, 80));
      if (!session || session.caseId !== id) throw new HttpError(410, "這次查詢已逾時，請重新查詢", "QUERY_EXPIRED");
      const candidateIndex = Number(input.candidateIndex);
      const official = Number.isInteger(candidateIndex) ? session.candidates[candidateIndex] : null;
      if (!official) throw new HttpError(400, "請選擇要連結的官方案件");
      current = getCase.get(id);
      const result = applyOfficialProgress(current, official, session.lookupAuthority);
      officialQuerySessions.delete(input.querySessionId);
      sendJson(response, 200, { ok: true, selectionRequired: false, ...result });
      return true;
    }

    let lookupAuthority = current.authority;
    if (!lookupAuthority) {
      try {
        const registry = await fetchRegistryData(current.taxId);
        lookupAuthority = cleanText(registry["登記機關"] || registry["主管機關"] || "", 100);
      } catch { /* 官方商工網站仍可能自行查到，繼續嘗試。 */ }
    }

    let candidates;
    try {
      candidates = await queryOfficialCases({
        entityType: current.entityType,
        taxId: current.taxId,
        companyName: current.companyName,
        authority: lookupAuthority,
      });
    } catch (error) {
      if (error instanceof OfficialQueryError) throw new HttpError(error.status, error.message);
      console.error("官方進度查詢失敗：", error);
      throw new HttpError(502, "官方網站目前無法完成查詢，請稍後再按一次");
    }
    const publicCandidates = officialCandidatesForClient(current, candidates);
    const chosen = chooseOfficialCandidate(current, candidates, publicCandidates);
    if (!chosen) {
      const querySessionId = saveSession(officialQuerySessions, {
        caseId: id, candidates, lookupAuthority,
      }, 10 * 60_000);
      sendJson(response, 200, {
        ok: true,
        selectionRequired: true,
        querySessionId,
        candidates: publicCandidates,
        message: `查到 ${candidates.length} 筆官方案件，請選擇這次辦理的案件`,
      });
      return true;
    }

    const result = applyOfficialProgress(current, chosen, lookupAuthority);
    sendJson(response, 200, { ok: true, selectionRequired: false, ...result });
    return true;
  }

  const taxSessionMatch = url.pathname.match(/^\/api\/cases\/(\d+)\/tax-query-session$/);
  if (request.method === "POST" && taxSessionMatch) {
    const id = Number(taxSessionMatch[1]);
    const current = getCase.get(id);
    if (!current) throw new HttpError(404, "找不到這筆案件");
    if (!/^\d{8}$/.test(current.taxId || "")) throw new HttpError(400, "這筆案件沒有統編，無法查詢國稅局進度");
    const input = await readJson(request);
    const bureauCode = cleanText(input.bureauCode || current.taxBureauCode || inferTaxBureau(current.address)?.bureauCode, 3).toUpperCase();
    if (!taxBureauCodes.has(bureauCode)) throw new HttpError(400, "請先選擇臺北、北區、中區、南區或高雄國稅局");
    let captcha;
    let ocrFailure = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        captcha = await createTaxCaptcha({ bureauCode });
        const captchaText = await recognizeTaxCaptcha(captcha.image);
        if (!/^[0-9A-Z]{4,6}$/.test(captchaText)) {
          ocrFailure = "驗證碼辨識結果格式不符";
          continue;
        }
        const candidates = await queryTaxCases({
          bureauCode,
          taxId: current.taxId,
          businessName: current.companyName,
          captchaText,
          captcha: { nonce: captcha.nonce, token: captcha.token },
        });
        if (!candidates.length) {
          sendJson(response, 201, {
            ok: true, automatic: true, sessionId: "", bureauCode,
            bureauName: taxBureaus[bureauCode].name, results: [],
            message: "驗證碼已自動辨識；官方網站查無一年內案件，請確認統編與營業人名稱",
          });
          return true;
        }
        const sessionId = saveSession(taxQuerySessions, {
          caseId: id, bureauCode, captcha: null, image: null,
          mimeType: captcha.mimeType, queried: true, candidates,
        }, 10 * 60_000);
        sendJson(response, 201, {
          ok: true, automatic: true, sessionId, bureauCode,
          bureauName: taxBureaus[bureauCode].name,
          results: taxCandidatesForClient(current, candidates),
          message: `已自動辨識驗證碼，查到 ${candidates.length} 筆國稅局案件`,
        });
        return true;
      } catch (error) {
        if (error instanceof TaxQueryError && error.code === "CAPTCHA_INVALID") {
          ocrFailure = error.message;
          continue;
        }
        if (error instanceof TaxQueryError) throw new HttpError(error.status, error.message, error.code);
        console.warn("驗證碼 OCR 自動辨識失敗：", error instanceof Error ? error.message : error);
        ocrFailure = "驗證碼自動辨識暫時無法使用";
        break;
      }
    }
    try {
      captcha = await createTaxCaptcha({ bureauCode });
    } catch (error) {
      if (error instanceof TaxQueryError) throw new HttpError(error.status, error.message, error.code);
      throw error;
    }
    const sessionId = saveSession(taxQuerySessions, {
      caseId: id,
      bureauCode,
      captcha: { nonce: captcha.nonce, token: captcha.token },
      image: captcha.image,
      mimeType: captcha.mimeType,
      queried: false,
      candidates: [],
    }, 110_000);
    sendJson(response, 201, {
      ok: true,
      sessionId,
      bureauCode,
      bureauName: taxBureaus[bureauCode].name,
      captchaUrl: `/api/tax-query-sessions/${sessionId}/captcha`,
      officialUrl: taxQueryUrl(bureauCode),
      automatic: false,
      results: [],
      message: `${ocrFailure || "驗證碼自動辨識未成功"}；請人工輸入圖片文字後查詢。`,
    });
    return true;
  }

  const taxCaptchaMatch = url.pathname.match(/^\/api\/tax-query-sessions\/([\da-f-]+)\/captcha$/i);
  if (request.method === "GET" && taxCaptchaMatch) {
    pruneSessions(taxQuerySessions);
    const session = taxQuerySessions.get(taxCaptchaMatch[1]);
    if (!session?.image) throw new HttpError(410, "驗證碼已逾時，請重新載入", "CAPTCHA_EXPIRED");
    response.writeHead(200, securityHeaders({
      "Content-Type": session.mimeType || "image/png",
      "Content-Length": String(session.image.length),
    }));
    response.end(session.image);
    return true;
  }

  const checkTaxMatch = url.pathname.match(/^\/api\/cases\/(\d+)\/check-tax-progress$/);
  if (request.method === "POST" && checkTaxMatch) {
    const id = Number(checkTaxMatch[1]);
    const current = getCase.get(id);
    if (!current) throw new HttpError(404, "找不到這筆案件");
    const input = await readJson(request);
    const sessionId = cleanText(input.sessionId, 80);
    pruneSessions(taxQuerySessions);
    const session = taxQuerySessions.get(sessionId);
    if (!session || session.caseId !== id || session.queried) throw new HttpError(410, "驗證碼已逾時，請重新載入", "CAPTCHA_EXPIRED");
    let candidates;
    try {
      candidates = await queryTaxCases({
        bureauCode: session.bureauCode,
        taxId: current.taxId,
        businessName: current.companyName,
        captchaText: cleanText(input.captchaText, 6),
        captcha: session.captcha,
      });
    } catch (error) {
      taxQuerySessions.delete(sessionId);
      if (error instanceof TaxQueryError) throw new HttpError(error.status, error.message, error.code);
      throw error;
    }
    if (!candidates.length) {
      taxQuerySessions.delete(sessionId);
      sendJson(response, 200, {
        ok: true, sessionId: "", results: [],
        message: "官方網站查無一年內案件；請確認國稅局區域、統編與營業人名稱",
      });
      return true;
    }
    session.queried = true;
    session.candidates = candidates;
    session.image = null;
    session.captcha = null;
    session.expiresAt = Date.now() + 10 * 60_000;
    sendJson(response, 200, {
      ok: true,
      sessionId,
      bureauCode: session.bureauCode,
      results: taxCandidatesForClient(current, candidates),
      message: `查到 ${candidates.length} 筆國稅局案件`,
    });
    return true;
  }

  const applyTaxMatch = url.pathname.match(/^\/api\/cases\/(\d+)\/apply-tax-progress$/);
  if (request.method === "POST" && applyTaxMatch) {
    const id = Number(applyTaxMatch[1]);
    const current = getCase.get(id);
    if (!current) throw new HttpError(404, "找不到這筆案件");
    const input = await readJson(request);
    const sessionId = cleanText(input.sessionId, 80);
    pruneSessions(taxQuerySessions);
    const session = taxQuerySessions.get(sessionId);
    if (!session || session.caseId !== id || !session.queried) throw new HttpError(410, "這次查詢已逾時，請重新查詢", "QUERY_EXPIRED");
    const candidateIndex = Number(input.candidateIndex);
    const official = Number.isInteger(candidateIndex) ? session.candidates[candidateIndex] : null;
    if (!official) throw new HttpError(400, "請選擇要連結的國稅局案件");
    const result = applyTaxProgress(current, official);
    taxQuerySessions.delete(sessionId);
    sendJson(response, 200, { ok: true, ...result });
    return true;
  }

  const billingMatch = url.pathname.match(/^\/api\/cases\/(\d+)\/billing$/);
  if (request.method === "PUT" && billingMatch) {
    const id = Number(billingMatch[1]);
    const current = getCase.get(id);
    if (!current) throw new HttpError(404, "找不到這筆案件");
    const input = await readJson(request);
    const billingStatus = cleanText(input.billingStatus, 20) || "未請款";
    if (!billingStatuses.has(billingStatus)) throw new HttpError(400, "請款狀態不正確");
    const billingDate = optionalDate(input.billingDate, "請款日期");
    const paidAmount = amount(input.paidAmount);
    const paymentDate = optionalDate(input.paymentDate, "收款日期");
    if (!Array.isArray(input.items) || input.items.length > 100) throw new HttpError(400, "收費項目格式不正確");
    const items = input.items.map((item, index) => ({
      itemName: cleanText(item.itemName, 200), amount: amount(item.amount), notes: cleanText(item.notes, 500), sortOrder: index,
    })).filter((item) => item.itemName || item.amount || item.notes);
    if (items.some((item) => !item.itemName)) throw new HttpError(400, "每一筆收費都要填寫辦理項目");
    const totalDue = items.reduce((sum, item) => sum + item.amount, 0);
    const finalBillingStatus = totalDue > 0 && paidAmount >= totalDue ? "已收款" : billingStatus;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM billing_items WHERE case_id = ?").run(id);
      items.forEach((item) => insertBillingItem.run(id, item.itemName, item.amount, item.notes, item.sortOrder));
      db.prepare(`
        UPDATE cases SET billing_status = ?, billing_date = ?, paid_amount = ?, payment_date = ?,
          service_fee = 0, government_fee = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(finalBillingStatus, billingDate, paidAmount, paymentDate, id);
      const detail = finalBillingStatus === "已收款" ? `已收款 ${paidAmount.toLocaleString("zh-TW")} 元`
        : finalBillingStatus === "已請款" ? `已請款 ${totalDue.toLocaleString("zh-TW")} 元` : "更新收費明細";
      insertEvent.run(id, paymentDate || billingDate || taipeiDate(), finalBillingStatus === "已收款" ? "收款" : "請款", current.status, detail);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    sendJson(response, 200, { ok: true, case: getCase.get(id), billingItems: getBillingItems.all(id) });
    return true;
  }

  const companyMatch = url.pathname.match(/^\/api\/company\/(\d{8})$/);
  if (request.method === "GET" && companyMatch) {
    sendJson(response, 200, { ok: true, company: await fetchRegistryData(companyMatch[1]) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/backup") {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
    const fileName = `案件管理系統備份-${stamp}.sqlite`;
    const destination = join(backupsDir, fileName);
    await backup(db, destination);
    response.writeHead(200, securityHeaders({
      "Content-Type": "application/vnd.sqlite3",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": String(statSync(destination).size),
    }));
    createReadStream(destination).pipe(response);
    return true;
  }
  return false;
}

function serveStatic(request, response, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { throw new HttpError(400, "網址格式不正確"); }
  const relative = decoded === "/" ? "index.html" : normalize(decoded.replace(/^\/+/, ""));
  const filePath = resolve(publicDir, relative);
  const base = resolve(publicDir);
  if (!filePath.startsWith(`${base}${process.platform === "win32" ? "\\" : "/"}`) && filePath !== join(base, "index.html")) throw new HttpError(403, "禁止存取");
  if (!existsSync(filePath)) throw new HttpError(404, "找不到頁面");
  const body = readFileSync(filePath);
  response.writeHead(200, securityHeaders({
    "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  }));
  if (request.method === "HEAD") response.end(); else response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url);
      if (!handled) throw new HttpError(404, "找不到功能");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "不支援此操作");
    serveStatic(request, response, url.pathname);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    if (!response.headersSent) sendJson(response, status, {
      ok: false, message: error.message || "系統發生錯誤", code: error.code || "",
    });
    else response.end();
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") console.error(`無法啟動：連接埠 ${port} 已被其他程式使用。`);
  else console.error("系統啟動失敗：", error);
  closeCaptchaOcr();
  db.close();
  process.exit(1);
});

function localAddresses() {
  const addresses = [];
  try {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries || []) if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  } catch { /* 本機使用不受影響。 */ }
  return addresses;
}

server.listen(port, host, () => {
  console.log("");
  console.log("案件管理系統已啟動");
  console.log(`本機開啟：http://localhost:${port}`);
  if (host === "0.0.0.0" || host === "::") {
    for (const address of localAddresses()) console.log(`同一個 Wi-Fi 的手機：http://${address}:${port}`);
  }
  console.log("關閉此視窗即可停止系統，SQLite 資料不會消失。");
  console.log("");
  if (process.platform === "win32" && process.env.AUTO_OPEN === "1") {
    const opener = spawn("cmd.exe", ["/c", "start", "", `http://localhost:${port}/?v=2.6.0`], {
      detached: true, stdio: "ignore", windowsHide: true,
    });
    opener.unref();
  }
});

function shutdown() { server.close(() => { closeCaptchaOcr(); db.close(); process.exit(0); }); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
