import { ensureCaseDatabase, getRawDb } from "../../../db";

const selectCases = "SELECT c.id, c.company_name AS companyName, c.summary, c.employee_id AS employeeId, e.name AS employeeName, c.status, c.stage, c.progress, c.updated_at AS updatedAt, c.completed_at AS completedAt, c.created_at AS createdAt FROM cases c JOIN employees e ON e.id = c.employee_id";

export async function GET(request: Request) {
  try {
    await ensureCaseDatabase();
    const url = new URL(request.url); const history = url.searchParams.get("history") === "1"; const month = url.searchParams.get("month")?.trim(); const employeeId = url.searchParams.get("employeeId")?.trim(); const company = url.searchParams.get("company")?.trim();
    const clauses = [history ? "c.status = 'completed'" : "c.status = 'ongoing'"]; const values: (string | number)[] = [];
    if (month && /^\d{4}-\d{2}$/.test(month)) { clauses.push("substr(c.completed_at, 1, 7) = ?"); values.push(month); }
    if (employeeId && /^\d+$/.test(employeeId)) { clauses.push("c.employee_id = ?"); values.push(Number(employeeId)); }
    if (company) { clauses.push("c.company_name LIKE ?"); values.push(`%${company}%`); }
    const db = await getRawDb(); const rows = await db.prepare(`${selectCases} WHERE ${clauses.join(" AND ")} ORDER BY ${history ? "c.completed_at DESC" : "c.updated_at DESC"}`).bind(...values).all(); const employees = await db.prepare("SELECT id, name FROM employees ORDER BY id").all();
    return Response.json({ cases: rows.results, employees: employees.results });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to read cases" }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    await ensureCaseDatabase(); const body = await request.json() as { companyName?: string; summary?: string; employeeId?: number }; const companyName = body.companyName?.trim(); const summary = body.summary?.trim(); const employeeId = Number(body.employeeId);
    if (!companyName || !summary || !Number.isInteger(employeeId)) return Response.json({ error: "公司名稱、摘要與承辦人皆為必填。" }, { status: 400 });
    const now = new Date().toISOString(); const result = await (await getRawDb()).prepare("INSERT INTO cases (company_name, summary, employee_id, status, stage, progress, updated_at, bonus_twd, created_at) VALUES (?, ?, ?, 'ongoing', 'name_precheck', 20, ?, 500, ?)").bind(companyName, summary, employeeId, now, now).run() as { meta: { last_row_id: number } };
    return Response.json({ id: result.meta.last_row_id }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to create case" }, { status: 500 }); }
}
