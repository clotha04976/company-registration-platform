import { ensureCaseDatabase, getRawDb } from "../../../../db";
export async function GET() {
  try {
    await ensureCaseDatabase();
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit" }).formatToParts(new Date());
    const month = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
    const db = await getRawDb();
    const [totals, employees] = await db.batch<{ results: Record<string, number>[] }[]>([
      db.prepare("SELECT COUNT(*) AS completedCount, COALESCE(SUM(bonus_twd), 0) AS bonusTotal FROM cases WHERE status = 'completed' AND substr(completed_at, 1, 7) = ?").bind(month),
      db.prepare("SELECT e.id, e.name, COUNT(c.id) AS completedCount, COALESCE(SUM(c.bonus_twd), 0) AS bonusTotal FROM employees e LEFT JOIN cases c ON c.employee_id = e.id AND c.status = 'completed' AND substr(c.completed_at, 1, 7) = ? GROUP BY e.id, e.name ORDER BY e.id").bind(month),
    ]);
    return Response.json({ month, completedCount: totals.results[0]?.completedCount ?? 0, bonusTotal: totals.results[0]?.bonusTotal ?? 0, employees: employees.results, bonusPerCase: 500 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to read dashboard" }, { status: 500 }); }
}
