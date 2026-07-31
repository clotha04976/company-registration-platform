import { ensureCaseDatabase, getRawDb } from "../../../../db";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureCaseDatabase();
    const { id } = await context.params; if (!/^\d+$/.test(id)) return Response.json({ error: "案件不存在" }, { status: 400 });
    const body = await request.json() as { employeeId?: number; action?: "complete" | "restore" };
    const now = new Date().toISOString(); const db = await getRawDb();
    if (body.action === "complete") await db.prepare("UPDATE cases SET status = 'completed', progress = 100, completed_at = ?, updated_at = ?, bonus_twd = 500 WHERE id = ? AND status = 'ongoing'").bind(now, now, Number(id)).run();
    else if (body.action === "restore") await db.prepare("UPDATE cases SET status = 'ongoing', progress = 90, completed_at = NULL, updated_at = ? WHERE id = ? AND status = 'completed'").bind(now, Number(id)).run();
    else if (Number.isInteger(Number(body.employeeId))) await db.prepare("UPDATE cases SET employee_id = ?, updated_at = ? WHERE id = ?").bind(Number(body.employeeId), now, Number(id)).run();
    else return Response.json({ error: "無效更新" }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to update case" }, { status: 500 }); }
}
