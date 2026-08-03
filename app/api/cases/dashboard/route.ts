import { ensureCaseDatabase, getRawDb } from "../../../../db";

function taipeiMonth() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

export async function GET(request: Request) {
  try {
    await ensureCaseDatabase();
    const requestedMonth = new URL(request.url).searchParams.get("month")?.trim();
    const month = requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : taipeiMonth();
    const db = await getRawDb();
    const now = new Date().toISOString();
    const [totals, employees, monthlyCases, staleTotal, staleCases] = await db.batch<{ results: Record<string, unknown>[] }[]>([
      db.prepare("SELECT COUNT(*) AS caseCount FROM cases WHERE substr(cases.created_at, 1, 7) = ?").bind(month),
      db.prepare("SELECT e.id, e.name, COUNT(c.id) AS caseCount FROM employees e LEFT JOIN cases c ON c.employee_id = e.id AND substr(c.created_at, 1, 7) = ? GROUP BY e.id, e.name ORDER BY e.id").bind(month),
      db.prepare("SELECT c.id, c.company_name AS companyName, c.summary, c.employee_id AS employeeId, e.name AS employeeName, c.stage, c.status, c.progress, c.updated_at AS updatedAt, c.created_at AS createdAt, c.completed_at AS completedAt FROM cases c JOIN employees e ON e.id = c.employee_id WHERE substr(c.created_at, 1, 7) = ? ORDER BY c.created_at DESC, c.id DESC").bind(month),
      db.prepare("SELECT COUNT(*) AS staleCount FROM cases WHERE status = 'ongoing' AND datetime(updated_at) <= datetime(?, '-30 days')").bind(now),
      db.prepare("SELECT c.id, c.company_name AS companyName, c.summary, c.employee_id AS employeeId, e.name AS employeeName, c.stage, c.status, c.progress, c.updated_at AS updatedAt, c.created_at AS createdAt FROM cases c JOIN employees e ON e.id = c.employee_id WHERE c.status = 'ongoing' AND datetime(c.updated_at) <= datetime(?, '-30 days') ORDER BY c.updated_at ASC, c.id ASC").bind(now),
    ]);
    return Response.json({ month, caseCount: totals.results[0]?.caseCount ?? 0, employees: employees.results, monthlyCases: monthlyCases.results, staleCount: staleTotal.results[0]?.staleCount ?? 0, staleCases: staleCases.results });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to read dashboard" }, { status: 500 }); }
}
