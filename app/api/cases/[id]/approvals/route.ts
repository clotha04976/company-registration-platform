import { ensureCaseDatabase, getRawDb } from "../../../../../db";

const agencies = ["city_government", "national_tax"] as const;
const statuses = ["not_received", "received", "archived"] as const;
type Agency = (typeof agencies)[number];
type ApprovalInput = {
  status?: string;
  approvalDate?: string | null;
  documentNumber?: string | null;
  cloudPath?: string | null;
};

const ownKeysOnly = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const nullableString = (value: unknown, max: number) =>
  value === null || (typeof value === "string" && value.trim().length <= max);
const validDate = (value: unknown) => {
  if (value === null || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(`${value}T00:00:00Z`);
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
};

async function caseExists(caseId: number) {
  const result = await (
    await getRawDb()
  )
    .prepare("SELECT id FROM cases WHERE id = ? LIMIT 1")
    .bind(caseId)
    .all();
  return result.results.length > 0;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureCaseDatabase();
    const { id } = await context.params;
    if (!/^\d+$/.test(id))
      return Response.json({ error: "案件編號格式不正確" }, { status: 400 });
    const caseId = Number(id);
    if (!(await caseExists(caseId)))
      return Response.json({ error: "找不到案件" }, { status: 404 });
    const db = await getRawDb();
    const [approvalRows, cardRows] = await db.batch<
      { results: Record<string, unknown>[] }[]
    >([
      db
        .prepare(
          "SELECT agency, status, approval_date AS approvalDate, document_number AS documentNumber, cloud_path AS cloudPath, updated_at AS updatedAt FROM case_approval_documents WHERE case_id = ?",
        )
        .bind(caseId),
      db
        .prepare(
          "SELECT original_received AS originalReceived, customer_copy_sent AS customerCopySent, updated_at AS updatedAt FROM registration_card_tracking WHERE case_id = ?",
        )
        .bind(caseId),
    ]);
    const approvals = Object.fromEntries(
      agencies.map((agency) => [
        agency,
        {
          agency,
          status: "not_received",
          approvalDate: null,
          documentNumber: null,
          cloudPath: null,
          updatedAt: null,
        },
      ]),
    );
    for (const row of approvalRows.results)
      approvals[row.agency as Agency] = {
        ...approvals[row.agency as Agency],
        ...row,
      };
    const card = cardRows.results[0];
    return Response.json({
      approvals,
      registrationCard: card
        ? {
            originalReceived: Boolean(card.originalReceived),
            customerCopySent: Boolean(card.customerCopySent),
            updatedAt: card.updatedAt,
          }
        : { originalReceived: false, customerCopySent: false, updatedAt: null },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to read approvals",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await ensureCaseDatabase();
    const { id } = await context.params;
    if (!/^\d+$/.test(id))
      return Response.json({ error: "案件編號格式不正確" }, { status: 400 });
    const caseId = Number(id);
    if (!(await caseExists(caseId)))
      return Response.json({ error: "找不到案件" }, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    if (
      !body ||
      typeof body !== "object" ||
      !ownKeysOnly(body, ["approvals", "registrationCard"])
    )
      return Response.json({ error: "包含不允許的欄位" }, { status: 400 });
    const approvalBody = body.approvals;
    const cardBody = body.registrationCard;
    if (
      !approvalBody ||
      typeof approvalBody !== "object" ||
      Array.isArray(approvalBody) ||
      !ownKeysOnly(approvalBody as Record<string, unknown>, [...agencies])
    )
      return Response.json(
        { error: "核准公文資料格式不正確" },
        { status: 400 },
      );
    for (const agency of agencies) {
      const item = (approvalBody as Record<Agency, ApprovalInput>)[agency];
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        !ownKeysOnly(item as Record<string, unknown>, [
          "status",
          "approvalDate",
          "documentNumber",
          "cloudPath",
        ])
      )
        return Response.json(
          { error: `${agency} 資料格式不正確` },
          { status: 400 },
        );
      if (!statuses.includes(item.status as (typeof statuses)[number]))
        return Response.json({ error: "公文狀態不正確" }, { status: 400 });
      if (!validDate(item.approvalDate))
        return Response.json({ error: "核准日期格式不正確" }, { status: 400 });
      if (
        !nullableString(item.documentNumber, 120) ||
        !nullableString(item.cloudPath, 500)
      )
        return Response.json(
          { error: "文字欄位過長或格式不正確" },
          { status: 400 },
        );
    }
    if (
      !cardBody ||
      typeof cardBody !== "object" ||
      Array.isArray(cardBody) ||
      !ownKeysOnly(cardBody as Record<string, unknown>, [
        "originalReceived",
        "customerCopySent",
      ])
    )
      return Response.json(
        { error: "登記事項卡資料格式不正確" },
        { status: 400 },
      );
    const card = cardBody as Record<string, unknown>;
    if (
      typeof card.originalReceived !== "boolean" ||
      typeof card.customerCopySent !== "boolean"
    )
      return Response.json(
        { error: "登記事項卡狀態必須為布林值" },
        { status: 400 },
      );
    const now = new Date().toISOString();
    const db = await getRawDb();
    await db.batch([
      ...agencies.map((agency) => {
        const item = (approvalBody as Record<Agency, ApprovalInput>)[agency];
        return db
          .prepare(
            "INSERT INTO case_approval_documents (case_id, agency, status, approval_date, document_number, cloud_path, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(case_id, agency) DO UPDATE SET status = excluded.status, approval_date = excluded.approval_date, document_number = excluded.document_number, cloud_path = excluded.cloud_path, updated_at = excluded.updated_at",
          )
          .bind(
            caseId,
            agency,
            item.status,
            item.approvalDate || null,
            item.documentNumber?.trim() || null,
            item.cloudPath?.trim() || null,
            now,
          );
      }),
      db
        .prepare(
          "INSERT INTO registration_card_tracking (case_id, original_received, customer_copy_sent, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(case_id) DO UPDATE SET original_received = excluded.original_received, customer_copy_sent = excluded.customer_copy_sent, updated_at = excluded.updated_at",
        )
        .bind(
          caseId,
          card.originalReceived ? 1 : 0,
          card.customerCopySent ? 1 : 0,
          now,
        ),
      db
        .prepare("UPDATE cases SET updated_at = ? WHERE id = ?")
        .bind(now, caseId),
    ]);
    return Response.json({ ok: true, updatedAt: now });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update approvals",
      },
      { status: 500 },
    );
  }
}
