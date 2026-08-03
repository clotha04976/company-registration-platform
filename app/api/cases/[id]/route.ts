import { ensureCaseDatabase, getRawDb } from "../../../../db";

const stageProgress = { name_precheck: 20, city_government: 55, national_tax: 85 } as const;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureCaseDatabase(); const { id } = await context.params; if (!/^\d+$/.test(id)) return Response.json({ error: "案件編號無效。" }, { status: 400 });
    const body = await request.json() as { employeeId?: number; stage?: keyof typeof stageProgress; action?: "complete" | "restore" }; const now = new Date().toISOString(); const db = await getRawDb(); const caseId = Number(id);
    if (body.action === "complete") await db.prepare("UPDATE cases SET status = 'completed', stage = 'completed', progress = 100, completed_at = ?, updated_at = ?, bonus_twd = 500 WHERE id = ? AND status = 'ongoing'").bind(now, now, caseId).run();
    else if (body.action === "restore") await db.prepare("UPDATE cases SET status = 'ongoing', stage = 'national_tax', progress = 85, completed_at = NULL, updated_at = ? WHERE id = ? AND status = 'completed'").bind(now, caseId).run();
    else if (body.stage && body.stage in stageProgress) await db.prepare("UPDATE cases SET status = 'ongoing', stage = ?, progress = ?, completed_at = NULL, updated_at = ? WHERE id = ?").bind(body.stage, stageProgress[body.stage], now, caseId).run();
    else if (Number.isInteger(Number(body.employeeId))) await db.prepare("UPDATE cases SET employee_id = ?, updated_at = ? WHERE id = ?").bind(Number(body.employeeId), now, caseId).run();
    else return Response.json({ error: "沒有可更新的欄位。" }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to update case" }, { status: 500 }); }
}
