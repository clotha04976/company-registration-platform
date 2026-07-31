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
      db.prepare("CREATE TABLE IF NOT EXISTS cases (id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL, summary TEXT NOT NULL, employee_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ongoing', progress INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, completed_at TEXT, bonus_twd INTEGER NOT NULL DEFAULT 500, created_at TEXT NOT NULL, FOREIGN KEY(employee_id) REFERENCES employees(id))"),
      db.prepare("CREATE INDEX IF NOT EXISTS cases_status_updated_idx ON cases(status, updated_at DESC)"),
      db.prepare("CREATE INDEX IF NOT EXISTS cases_completed_idx ON cases(completed_at DESC)"),
    ]);
    await db.batch(employeeNames.map((name, index) => db.prepare("INSERT OR IGNORE INTO employees (id, name) VALUES (?, ?)").bind(index + 1, name)));
    const now = new Date().toISOString();
    await db.prepare("INSERT OR IGNORE INTO cases (id, company_name, summary, employee_id, status, progress, updated_at, completed_at, bonus_twd, created_at) VALUES (1, ?, ?, 1, 'ongoing', 55, ?, NULL, 500, ?)").bind("範例工程有限公司", "冷凍、配管工程", now, now).run();
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO cases (id, company_name, summary, employee_id, status, progress, updated_at, completed_at, bonus_twd, created_at) VALUES (2, '示意：晴川設計有限公司', '室內設計示意案件', 2, 'completed', 100, ?, ?, 500, ?)").bind(now, new Date().toISOString(), now),
      db.prepare("INSERT OR IGNORE INTO cases (id, company_name, summary, employee_id, status, progress, updated_at, completed_at, bonus_twd, created_at) VALUES (3, '示意：日和餐飲有限公司', '餐飲業登記示意案件', 3, 'completed', 100, ?, ?, 500, ?)").bind(now, new Date().toISOString(), now),
    ]);
  })();
  return initialized;
}

export async function getDb() {
  return drizzle(await getRawDb() as never, { schema });
}
