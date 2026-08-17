from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

BUSY_TIMEOUT_SECONDS = 15.0

_initialized_path: Path | None = None
_initialization_lock = threading.Lock()

EMPLOYEE_NAMES = [
    "林彥丞",
    "林盈孜",
    "黃郁庭",
    "施美澖",
    "鄧秀英",
    "郭雅萍",
    "吳典霞",
    "翁莉雯",
    "黃柏捷",
    "蕭鈴臻",
]

DEFAULT_DATABASE_PATH = Path(__file__).resolve().parent.parent / "data" / "cases.db"

SCHEMA_STATEMENTS = [
    "CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)",
    "CREATE TABLE IF NOT EXISTS cases (id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL, summary TEXT NOT NULL, employee_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ongoing', stage TEXT NOT NULL DEFAULT 'name_precheck', progress INTEGER NOT NULL DEFAULT 20, updated_at TEXT NOT NULL, completed_at TEXT, bonus_twd INTEGER NOT NULL DEFAULT 500, created_at TEXT NOT NULL, FOREIGN KEY(employee_id) REFERENCES employees(id))",
    "CREATE INDEX IF NOT EXISTS cases_status_updated_idx ON cases(status, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS cases_completed_idx ON cases(completed_at DESC)",
    "CREATE TABLE IF NOT EXISTS case_approval_documents (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, agency TEXT NOT NULL CHECK (agency IN ('city_government', 'national_tax')), status TEXT NOT NULL DEFAULT 'not_received' CHECK (status IN ('not_received', 'received', 'archived')), approval_date TEXT, document_number TEXT, cloud_path TEXT, updated_at TEXT NOT NULL, FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE, UNIQUE(case_id, agency))",
    "CREATE INDEX IF NOT EXISTS case_approval_documents_case_status_idx ON case_approval_documents(case_id, status)",
    "CREATE TABLE IF NOT EXISTS registration_card_tracking (case_id INTEGER PRIMARY KEY NOT NULL, original_received INTEGER NOT NULL DEFAULT 0, customer_copy_sent INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE)",
]


def database_path() -> Path:
    configured = os.getenv("CASES_DATABASE_PATH", "").strip()
    return Path(configured) if configured else DEFAULT_DATABASE_PATH


def now_iso() -> str:
    """Match the ``new Date().toISOString()`` format the previous API stored."""
    stamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    return stamp.replace("+00:00", "Z")


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    # The dashboard loads three requests at once, so a writer must wait for the
    # lock instead of failing immediately with "database is locked".
    connection = sqlite3.connect(path, isolation_level=None, timeout=BUSY_TIMEOUT_SECONDS)
    connection.row_factory = sqlite3.Row
    try:
        # WAL lets those concurrent reads run while a write is in flight.
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute(f"PRAGMA busy_timeout = {int(BUSY_TIMEOUT_SECONDS * 1000)}")
        connection.execute("PRAGMA foreign_keys = ON")
        yield connection
    finally:
        connection.close()


def ensure_case_database() -> None:
    """Create the schema once per database, mirroring the previous cached promise."""
    global _initialized_path
    path = database_path()
    if _initialized_path == path:
        return
    with _initialization_lock:
        if _initialized_path == path:
            return
        with connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                for statement in SCHEMA_STATEMENTS:
                    connection.execute(statement)
                connection.executemany(
                    "INSERT OR IGNORE INTO employees (id, name) VALUES (?, ?)",
                    [(index + 1, name) for index, name in enumerate(EMPLOYEE_NAMES)],
                )
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
            connection.execute("PRAGMA optimize")
        _initialized_path = path


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict]:
    return [dict(row) for row in rows]
