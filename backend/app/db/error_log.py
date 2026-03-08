"""
Error log for scraper failures.
Backend: SQLite (local, default) or PostgreSQL (server, DATABASE_URL env var).
Only errors are stored — no success records.
"""
import threading
from datetime import datetime, timezone, timedelta
from typing import Optional

from app.db.adapter import USE_POSTGRES, PH, make_pg_conn, serial_pk, fetch_all, fetch_one

_local = threading.local()


def _conn():
    if not hasattr(_local, "conn") or _local.conn is None:
        if USE_POSTGRES:
            _local.conn = make_pg_conn()
        else:
            import sqlite3
            from app.db.paths import DATA_DIR
            conn = sqlite3.connect(str(DATA_DIR / "scrape_errors.db"), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            _local.conn = conn
    return _local.conn


def _ex(sql: str, params: tuple = ()):
    conn = _conn()
    if USE_POSTGRES:
        cur = conn.cursor()
        cur.execute(sql, params)
        return cur
    return conn.execute(sql, params)


def _commit():
    _conn().commit()


def init_db() -> None:
    _ex(f"""
        CREATE TABLE IF NOT EXISTS scrape_errors (
            id              {serial_pk()} ,
            timestamp       TEXT    NOT NULL,
            scraper_type    TEXT    NOT NULL,
            job_id          TEXT,
            context         TEXT    NOT NULL,
            url             TEXT,
            error_type      TEXT    NOT NULL,
            error_message   TEXT,
            attempt         INTEGER,
            screenshot_file TEXT
        )
    """)
    _commit()


def log_error(
    *,
    scraper_type: str,
    context: str,
    error_type: str,
    error_message: Optional[str] = None,
    url: Optional[str] = None,
    job_id: Optional[str] = None,
    attempt: Optional[int] = None,
    screenshot_file: Optional[str] = None,
) -> int:
    ts = datetime.now(timezone.utc).isoformat()
    if USE_POSTGRES:
        cur = _ex(
            f"""INSERT INTO scrape_errors
               (timestamp, scraper_type, job_id, context, url, error_type, error_message, attempt, screenshot_file)
               VALUES ({PH},{PH},{PH},{PH},{PH},{PH},{PH},{PH},{PH}) RETURNING id""",
            (ts, scraper_type, job_id, context, url, error_type, error_message, attempt, screenshot_file),
        )
        row = fetch_one(cur)
        _commit()
        return row["id"] if row else -1
    else:
        cur = _ex(
            f"""INSERT INTO scrape_errors
               (timestamp, scraper_type, job_id, context, url, error_type, error_message, attempt, screenshot_file)
               VALUES ({PH},{PH},{PH},{PH},{PH},{PH},{PH},{PH},{PH})""",
            (ts, scraper_type, job_id, context, url, error_type, error_message, attempt, screenshot_file),
        )
        _commit()
        return cur.lastrowid


def get_errors(
    *,
    limit: int = 200,
    scraper_type: Optional[str] = None,
    error_type: Optional[str] = None,
) -> list[dict]:
    clauses = []
    params: list = []
    if scraper_type:
        clauses.append(f"scraper_type = {PH}")
        params.append(scraper_type)
    if error_type:
        clauses.append(f"error_type = {PH}")
        params.append(error_type)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    params.append(limit)
    cur = _ex(f"SELECT * FROM scrape_errors {where} ORDER BY id DESC LIMIT {PH}", tuple(params))
    return fetch_all(cur)


def delete_error(error_id: int) -> bool:
    cur = _ex(f"DELETE FROM scrape_errors WHERE id = {PH}", (error_id,))
    _commit()
    return cur.rowcount > 0


def delete_all_errors() -> int:
    cur = _ex("DELETE FROM scrape_errors")
    _commit()
    return cur.rowcount


def count_last_24h() -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    cur = _ex(f"SELECT COUNT(*) as cnt FROM scrape_errors WHERE timestamp >= {PH}", (cutoff,))
    row = fetch_one(cur)
    if row is None:
        return 0
    return row["cnt"] if "cnt" in row else list(row.values())[0]
