from __future__ import annotations

import json
import math
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from .db import connect, ensure_case_database, now_iso, rows_to_dicts

router = APIRouter(prefix="/api/cases")

AGENCIES = ("city_government", "national_tax")
APPROVAL_STATUSES = ("not_received", "received", "archived")
STAGE_PROGRESS = {"name_precheck": 20, "city_government": 55, "national_tax": 85}
TAIPEI = timezone(timedelta(hours=8))

MONTH_PATTERN = re.compile(r"^\d{4}-\d{2}$")
DIGITS_PATTERN = re.compile(r"^\d+$")
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

SELECT_CASES = (
    "SELECT c.id, c.company_name AS companyName, c.summary, c.employee_id AS employeeId, "
    "e.name AS employeeName, c.status, c.stage, c.progress, c.updated_at AS updatedAt, "
    "c.completed_at AS completedAt, c.created_at AS createdAt "
    "FROM cases c JOIN employees e ON e.id = c.employee_id"
)


def taipei_month() -> str:
    return datetime.now(TAIPEI).strftime("%Y-%m")


def js_number(value: Any) -> float:
    """Mimic JavaScript ``Number(value)`` so validation matches the previous API."""
    if value is None or isinstance(value, (dict, list)):
        return math.nan
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return 0.0
        try:
            return float(text)
        except ValueError:
            return math.nan
    return math.nan


def is_integer(value: float) -> bool:
    return not math.isnan(value) and not math.isinf(value) and value == int(value)


def own_keys_only(value: dict, allowed: tuple[str, ...]) -> bool:
    return all(key in allowed for key in value)


def nullable_string(value: Any, maximum: int) -> bool:
    return value is None or (isinstance(value, str) and len(value.strip()) <= maximum)


def valid_date(value: Any) -> bool:
    if value is None or value == "":
        return True
    if not isinstance(value, str) or not DATE_PATTERN.match(value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def trimmed(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def case_row(connection: sqlite3.Connection, case_id: int) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT stage, status FROM cases WHERE id = ?", (case_id,)
    ).fetchone()


def parse_case_id(raw: str, message: str) -> int:
    if not DIGITS_PATTERN.match(raw):
        raise HTTPException(400, message)
    return int(raw)


async def read_json_body(request: Request, message: str) -> Any:
    """Parse the request body directly so malformed JSON keeps the original 400 reply."""
    raw = await request.body()
    if not raw:
        raise HTTPException(400, message)
    try:
        return json.loads(raw)
    except ValueError:
        raise HTTPException(400, message)


@router.get("")
def list_cases(request: Request) -> dict:
    ensure_case_database()
    params = request.query_params
    history = params.get("history") == "1"
    month = trimmed(params.get("month"))
    employee_id = trimmed(params.get("employeeId"))
    company = trimmed(params.get("company"))

    clauses = ["c.status = 'completed'" if history else "c.status = 'ongoing'"]
    values: list[Any] = []
    if month and MONTH_PATTERN.match(month):
        clauses.append("substr(c.completed_at, 1, 7) = ?")
        values.append(month)
    if employee_id and DIGITS_PATTERN.match(employee_id):
        clauses.append("c.employee_id = ?")
        values.append(int(employee_id))
    if company:
        clauses.append("c.company_name LIKE ?")
        values.append(f"%{company}%")

    order = "c.completed_at DESC" if history else "c.updated_at DESC"
    query = f"{SELECT_CASES} WHERE {' AND '.join(clauses)} ORDER BY {order}"
    with connect() as connection:
        cases = rows_to_dicts(connection.execute(query, values).fetchall())
        employees = rows_to_dicts(
            connection.execute("SELECT id, name FROM employees ORDER BY id").fetchall()
        )
    return {"cases": cases, "employees": employees}


@router.post("", status_code=201)
async def create_case(request: Request) -> dict:
    ensure_case_database()
    body = await read_json_body(request, "公司名稱、摘要與承辦人皆為必填。")
    if not isinstance(body, dict):
        raise HTTPException(400, "公司名稱、摘要與承辦人皆為必填。")
    company_name = trimmed(body.get("companyName"))
    summary = trimmed(body.get("summary"))
    employee_id = js_number(body.get("employeeId"))
    if not company_name or not summary or not is_integer(employee_id):
        raise HTTPException(400, "公司名稱、摘要與承辦人皆為必填。")

    now = now_iso()
    with connect() as connection:
        cursor = connection.execute(
            "INSERT INTO cases (company_name, summary, employee_id, status, stage, progress, updated_at, bonus_twd, created_at) "
            "VALUES (?, ?, ?, 'ongoing', 'name_precheck', 20, ?, 500, ?)",
            (company_name, summary, int(employee_id), now, now),
        )
        return {"id": cursor.lastrowid}


@router.get("/dashboard")
def dashboard(request: Request) -> dict:
    ensure_case_database()
    requested = trimmed(request.query_params.get("month"))
    month = requested if requested and MONTH_PATTERN.match(requested) else taipei_month()
    now = now_iso()

    with connect() as connection:
        case_count = connection.execute(
            "SELECT COUNT(*) AS caseCount FROM cases WHERE substr(cases.created_at, 1, 7) = ?",
            (month,),
        ).fetchone()["caseCount"]
        employees = rows_to_dicts(
            connection.execute(
                "SELECT e.id, e.name, COUNT(c.id) AS caseCount FROM employees e "
                "LEFT JOIN cases c ON c.employee_id = e.id AND substr(c.created_at, 1, 7) = ? "
                "GROUP BY e.id, e.name ORDER BY e.id",
                (month,),
            ).fetchall()
        )
        monthly_cases = rows_to_dicts(
            connection.execute(
                "SELECT c.id, c.company_name AS companyName, c.summary, c.employee_id AS employeeId, "
                "e.name AS employeeName, c.stage, c.status, c.progress, c.updated_at AS updatedAt, "
                "c.created_at AS createdAt, c.completed_at AS completedAt "
                "FROM cases c JOIN employees e ON e.id = c.employee_id "
                "WHERE substr(c.created_at, 1, 7) = ? ORDER BY c.created_at DESC, c.id DESC",
                (month,),
            ).fetchall()
        )
        stale_count = connection.execute(
            "SELECT COUNT(*) AS staleCount FROM cases WHERE status = 'ongoing' "
            "AND datetime(updated_at) <= datetime(?, '-30 days')",
            (now,),
        ).fetchone()["staleCount"]
        stale_cases = rows_to_dicts(
            connection.execute(
                "SELECT c.id, c.company_name AS companyName, c.summary, c.employee_id AS employeeId, "
                "e.name AS employeeName, c.stage, c.status, c.progress, c.updated_at AS updatedAt, "
                "c.created_at AS createdAt FROM cases c JOIN employees e ON e.id = c.employee_id "
                "WHERE c.status = 'ongoing' AND datetime(c.updated_at) <= datetime(?, '-30 days') "
                "ORDER BY c.updated_at ASC, c.id ASC",
                (now,),
            ).fetchall()
        )

    return {
        "month": month,
        "caseCount": case_count,
        "employees": employees,
        "monthlyCases": monthly_cases,
        "staleCount": stale_count,
        "staleCases": stale_cases,
    }


@router.patch("/{raw_id}")
async def update_case(raw_id: str, request: Request) -> dict:
    ensure_case_database()
    case_id = parse_case_id(raw_id, "案件編號無效。")
    body = await read_json_body(request, "更新內容無效。")
    if not isinstance(body, dict):
        raise HTTPException(400, "更新內容無效。")

    with connect() as connection:
        row = case_row(connection, case_id)
        if row is None:
            raise HTTPException(404, "找不到案件。")
        stage, status = row["stage"], row["status"]
        now = now_iso()

        if body.get("action") == "advance_after_precheck":
            if stage == "name_precheck" and status == "ongoing":
                connection.execute(
                    "UPDATE cases SET stage = 'city_government', progress = 55, updated_at = ? "
                    "WHERE id = ? AND status = 'ongoing' AND stage = 'name_precheck'",
                    (now, case_id),
                )
            elif stage == "city_government" and status == "ongoing":
                connection.execute(
                    "UPDATE cases SET updated_at = ? WHERE id = ?", (now, case_id)
                )
            after = case_row(connection, case_id)
            after_stage = after["stage"] if after is not None else stage
            return {
                "ok": True,
                "stage": after_stage,
                "changed": stage == "name_precheck" and after_stage == "city_government",
            }

        if "stage" in body:
            requested_stage = body["stage"]
            if not isinstance(requested_stage, str) or requested_stage not in STAGE_PROGRESS:
                raise HTTPException(400, "案件階段無效。")
            connection.execute(
                "UPDATE cases SET status = 'ongoing', stage = ?, progress = ?, "
                "completed_at = NULL, updated_at = ? WHERE id = ?",
                (requested_stage, STAGE_PROGRESS[requested_stage], now, case_id),
            )
            return {
                "ok": True,
                "stage": requested_stage,
                "changed": requested_stage != stage,
            }

        action = body.get("action")
        if action == "complete":
            changed = status == "ongoing"
            if changed:
                connection.execute(
                    "UPDATE cases SET status = 'completed', stage = 'completed', progress = 100, "
                    "completed_at = ?, updated_at = ?, bonus_twd = 500 WHERE id = ? AND status = 'ongoing'",
                    (now, now, case_id),
                )
            return {"ok": True, "stage": "completed", "changed": changed}

        if action == "restore":
            changed = status == "completed"
            if changed:
                connection.execute(
                    "UPDATE cases SET status = 'ongoing', stage = 'national_tax', progress = 85, "
                    "completed_at = NULL, updated_at = ? WHERE id = ? AND status = 'completed'",
                    (now, case_id),
                )
            return {
                "ok": True,
                "stage": "national_tax" if changed else stage,
                "changed": changed,
            }

        if action == "keep_active":
            connection.execute(
                "UPDATE cases SET updated_at = ? WHERE id = ? AND status = 'ongoing'",
                (now, case_id),
            )
            return {"ok": True, "stage": stage, "changed": False}

        if "action" in body:
            raise HTTPException(400, "案件動作無效。")

        employee_id = js_number(body.get("employeeId"))
        if is_integer(employee_id) and employee_id > 0:
            connection.execute(
                "UPDATE cases SET employee_id = ?, updated_at = ? WHERE id = ?",
                (int(employee_id), now, case_id),
            )
            return {"ok": True, "stage": stage, "changed": False}

        raise HTTPException(400, "沒有可更新的欄位。")


def case_exists(connection: sqlite3.Connection, case_id: int) -> bool:
    found = connection.execute(
        "SELECT id FROM cases WHERE id = ? LIMIT 1", (case_id,)
    ).fetchone()
    return found is not None


@router.get("/{raw_id}/approvals")
def read_approvals(raw_id: str) -> dict:
    ensure_case_database()
    case_id = parse_case_id(raw_id, "案件編號格式不正確")

    with connect() as connection:
        if not case_exists(connection, case_id):
            raise HTTPException(404, "找不到案件")
        approval_rows = connection.execute(
            "SELECT agency, status, approval_date AS approvalDate, document_number AS documentNumber, "
            "cloud_path AS cloudPath, updated_at AS updatedAt FROM case_approval_documents WHERE case_id = ?",
            (case_id,),
        ).fetchall()
        card = connection.execute(
            "SELECT original_received AS originalReceived, customer_copy_sent AS customerCopySent, "
            "updated_at AS updatedAt FROM registration_card_tracking WHERE case_id = ?",
            (case_id,),
        ).fetchone()

    approvals = {
        agency: {
            "agency": agency,
            "status": "not_received",
            "approvalDate": None,
            "documentNumber": None,
            "cloudPath": None,
            "updatedAt": None,
        }
        for agency in AGENCIES
    }
    for row in approval_rows:
        approvals[row["agency"]] = {**approvals[row["agency"]], **dict(row)}

    registration_card = (
        {
            "originalReceived": bool(card["originalReceived"]),
            "customerCopySent": bool(card["customerCopySent"]),
            "updatedAt": card["updatedAt"],
        }
        if card is not None
        else {"originalReceived": False, "customerCopySent": False, "updatedAt": None}
    )
    return {"approvals": approvals, "registrationCard": registration_card}


@router.patch("/{raw_id}/approvals")
async def update_approvals(raw_id: str, request: Request) -> dict:
    ensure_case_database()
    case_id = parse_case_id(raw_id, "案件編號格式不正確")
    body = await read_json_body(request, "包含不允許的欄位")

    with connect() as connection:
        if not case_exists(connection, case_id):
            raise HTTPException(404, "找不到案件")

        if not isinstance(body, dict) or not own_keys_only(
            body, ("approvals", "registrationCard")
        ):
            raise HTTPException(400, "包含不允許的欄位")

        approval_body = body.get("approvals")
        if not isinstance(approval_body, dict) or not own_keys_only(
            approval_body, AGENCIES
        ):
            raise HTTPException(400, "核准公文資料格式不正確")

        for agency in AGENCIES:
            item = approval_body.get(agency)
            if not isinstance(item, dict) or not own_keys_only(
                item, ("status", "approvalDate", "documentNumber", "cloudPath")
            ):
                raise HTTPException(400, f"{agency} 資料格式不正確")
            if item.get("status") not in APPROVAL_STATUSES:
                raise HTTPException(400, "公文狀態不正確")
            if not valid_date(item.get("approvalDate")):
                raise HTTPException(400, "核准日期格式不正確")
            if not nullable_string(item.get("documentNumber"), 120) or not nullable_string(
                item.get("cloudPath"), 500
            ):
                raise HTTPException(400, "文字欄位過長或格式不正確")

        card_body = body.get("registrationCard")
        if not isinstance(card_body, dict) or not own_keys_only(
            card_body, ("originalReceived", "customerCopySent")
        ):
            raise HTTPException(400, "登記事項卡資料格式不正確")
        original_received = card_body.get("originalReceived")
        customer_copy_sent = card_body.get("customerCopySent")
        if not isinstance(original_received, bool) or not isinstance(
            customer_copy_sent, bool
        ):
            raise HTTPException(400, "登記事項卡狀態必須為布林值")

        now = now_iso()
        connection.execute("BEGIN")
        try:
            for agency in AGENCIES:
                item = approval_body[agency]
                connection.execute(
                    "INSERT INTO case_approval_documents (case_id, agency, status, approval_date, document_number, cloud_path, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(case_id, agency) DO UPDATE SET "
                    "status = excluded.status, approval_date = excluded.approval_date, "
                    "document_number = excluded.document_number, cloud_path = excluded.cloud_path, "
                    "updated_at = excluded.updated_at",
                    (
                        case_id,
                        agency,
                        item["status"],
                        item.get("approvalDate") or None,
                        trimmed(item.get("documentNumber")) or None,
                        trimmed(item.get("cloudPath")) or None,
                        now,
                    ),
                )
            connection.execute(
                "INSERT INTO registration_card_tracking (case_id, original_received, customer_copy_sent, updated_at) "
                "VALUES (?, ?, ?, ?) ON CONFLICT(case_id) DO UPDATE SET "
                "original_received = excluded.original_received, "
                "customer_copy_sent = excluded.customer_copy_sent, updated_at = excluded.updated_at",
                (case_id, 1 if original_received else 0, 1 if customer_copy_sent else 0, now),
            )
            connection.execute(
                "UPDATE cases SET updated_at = ? WHERE id = ?", (now, case_id)
            )
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise

    return {"ok": True, "updatedAt": now}
