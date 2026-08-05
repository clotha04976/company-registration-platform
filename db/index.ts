import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export const employeeNames = ["林彥丞", "林盈孜", "黃郁庭", "施美澖", "鄧秀英", "郭雅萍", "吳典霞", "翁莉雯", "黃柏捷", "蕭鈴臻"];

type D1Statement = { bind(...values: unknown[]): D1Statement; run(): Promise<unknown>; all<T = unknown>(): Promise<{ results: T[] }> };
type RawD1 = { prepare(query: string): D1Statement; batch<T = unknown>(statements: D1Statement[]): Promise<T> };

export async function getRawDb(): Promise<RawD1> {
  // @ts-expect-error Cloudflare provides this virtual module at Worker runtime.
  const { env } = await import("cloudflare:workers") as unknown as { env: { DB?: RawD1 } };
  if (!env.DB) throw new Error("D1 database is unavailable.");
  return env.DB;
}

let initialized: Promise<void> | undefined;
export function ensureCaseDatabase() {
  if (initialized) return initialized;
  initialized = (async () => {
    const db = await getRawDb();
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)"),
      db.prepare("CREATE TABLE IF NOT EXISTS cases (id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL, summary TEXT NOT NULL, employee_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ongoing', stage TEXT NOT NULL DEFAULT 'name_precheck', progress INTEGER NOT NULL DEFAULT 20, updated_at TEXT NOT NULL, completed_at TEXT, bonus_twd INTEGER NOT NULL DEFAULT 500, created_at TEXT NOT NULL, FOREIGN KEY(employee_id) REFERENCES employees(id))"),
      db.prepare("CREATE INDEX IF NOT EXISTS cases_status_updated_idx ON cases(status, updated_at DESC)"),
      db.prepare("CREATE INDEX IF NOT EXISTS cases_completed_idx ON cases(completed_at DESC)"),
      db.prepare("CREATE TABLE IF NOT EXISTS case_approval_documents (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, agency TEXT NOT NULL CHECK (agency IN ('city_government', 'national_tax')), status TEXT NOT NULL DEFAULT 'not_received' CHECK (status IN ('not_received', 'received', 'archived')), approval_date TEXT, document_number TEXT, cloud_path TEXT, updated_at TEXT NOT NULL, FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE, UNIQUE(case_id, agency))"),
      db.prepare("CREATE INDEX IF NOT EXISTS case_approval_documents_case_status_idx ON case_approval_documents(case_id, status)"),
      db.prepare("CREATE TABLE IF NOT EXISTS registration_card_tracking (case_id INTEGER PRIMARY KEY NOT NULL, original_received INTEGER NOT NULL DEFAULT 0, customer_copy_sent INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE)"),
      db.prepare("PRAGMA optimize"),
    ]);
    const columns = await db.prepare("PRAGMA table_info(cases)").all<{ name: string }>();
    if (!columns.results.some((column) => column.name === "stage")) await db.prepare("ALTER TABLE cases ADD COLUMN stage TEXT NOT NULL DEFAULT 'name_precheck'").run();
    await db.prepare("UPDATE cases SET stage = CASE WHEN status = 'completed' THEN 'completed' WHEN progress >= 75 THEN 'national_tax' WHEN progress >= 35 THEN 'city_government' ELSE 'name_precheck' END WHERE stage IS NULL OR stage = '' OR (stage = 'name_precheck' AND progress > 20)").run();
    await db.batch(employeeNames.map((name, index) => db.prepare("INSERT OR IGNORE INTO employees (id, name) VALUES (?, ?)").bind(index + 1, name)));
  })();
  return initialized;
}

export async function getDb() { return drizzle(await getRawDb() as never, { schema }); }
