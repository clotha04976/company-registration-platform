import { ensureCaseDatabase, getRawDb } from "../../../../db";

const stageProgress = {
  name_precheck: 20,
  city_government: 55,
  national_tax: 85,
} as const;

type CaseRow = {
  stage: "name_precheck" | "city_government" | "national_tax" | "completed";
  status: "ongoing" | "completed";
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureCaseDatabase();
    const { id } = await context.params;
    if (!/^\d+$/.test(id))
      return Response.json({ error: "案件編號無效。" }, { status: 400 });
    let body: {
      employeeId?: number;
      stage?: string;
      action?:
        | "complete"
        | "restore"
        | "keep_active"
        | "advance_after_precheck";
    };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "更新內容無效。" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return Response.json({ error: "更新內容無效。" }, { status: 400 });

    const db = await getRawDb();
    const caseId = Number(id);
    const rowResult = (await db
      .prepare("SELECT stage, status FROM cases WHERE id = ?")
      .bind(caseId)
      .all()) as { results: CaseRow[] };
    const row = rowResult.results[0] ?? null;
    if (!row)
      return Response.json({ error: "找不到案件。" }, { status: 404 });
    const now = new Date().toISOString();

    if (body.action === "advance_after_precheck") {
      if (row.stage === "name_precheck" && row.status === "ongoing")
        await db
          .prepare(
            "UPDATE cases SET stage = 'city_government', progress = 55, updated_at = ? WHERE id = ? AND status = 'ongoing' AND stage = 'name_precheck'",
          )
          .bind(now, caseId)
          .run();
      else if (row.stage === "city_government" && row.status === "ongoing")
        await db
          .prepare("UPDATE cases SET updated_at = ? WHERE id = ?")
          .bind(now, caseId)
          .run();
      const afterResult = (await db
        .prepare("SELECT stage, status FROM cases WHERE id = ?")
        .bind(caseId)
        .all()) as { results: CaseRow[] };
      const after = afterResult.results[0] ?? row;
      return Response.json({
        ok: true,
        stage: after.stage,
        changed:
          row.stage === "name_precheck" && after.stage === "city_government",
      });
    }

    if (Object.prototype.hasOwnProperty.call(body, "stage")) {
      if (typeof body.stage !== "string" || !(body.stage in stageProgress))
        return Response.json({ error: "案件階段無效。" }, { status: 400 });
      await db
        .prepare(
          "UPDATE cases SET status = 'ongoing', stage = ?, progress = ?, completed_at = NULL, updated_at = ? WHERE id = ?",
        )
        .bind(
          body.stage,
          stageProgress[body.stage as keyof typeof stageProgress],
          now,
          caseId,
        )
        .run();
      return Response.json({
        ok: true,
        stage: body.stage,
        changed: body.stage !== row.stage,
      });
    }

    if (body.action === "complete") {
      const changed = row.status === "ongoing";
      if (changed)
        await db
          .prepare(
            "UPDATE cases SET status = 'completed', stage = 'completed', progress = 100, completed_at = ?, updated_at = ?, bonus_twd = 500 WHERE id = ? AND status = 'ongoing'",
          )
          .bind(now, now, caseId)
          .run();
      return Response.json({ ok: true, stage: "completed", changed });
    }
    if (body.action === "restore") {
      const changed = row.status === "completed";
      if (changed)
        await db
          .prepare(
            "UPDATE cases SET status = 'ongoing', stage = 'national_tax', progress = 85, completed_at = NULL, updated_at = ? WHERE id = ? AND status = 'completed'",
          )
          .bind(now, caseId)
          .run();
      return Response.json({
        ok: true,
        stage: changed ? "national_tax" : row.stage,
        changed,
      });
    }
    if (body.action === "keep_active") {
      await db
        .prepare("UPDATE cases SET updated_at = ? WHERE id = ? AND status = 'ongoing'")
        .bind(now, caseId)
        .run();
      return Response.json({ ok: true, stage: row.stage, changed: false });
    }
    if (Object.prototype.hasOwnProperty.call(body, "action"))
      return Response.json({ error: "案件動作無效。" }, { status: 400 });
    if (Number.isInteger(Number(body.employeeId)) && Number(body.employeeId) > 0) {
      await db
        .prepare("UPDATE cases SET employee_id = ?, updated_at = ? WHERE id = ?")
        .bind(Number(body.employeeId), now, caseId)
        .run();
      return Response.json({ ok: true, stage: row.stage, changed: false });
    }
    return Response.json({ error: "沒有可更新的欄位。" }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update case" },
      { status: 500 },
    );
  }
}
