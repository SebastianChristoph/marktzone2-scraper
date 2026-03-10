"""
Persistence for daily scraper sessions.
Backend: SQLite (local) or PostgreSQL (server, DATABASE_URL env var).
"""
import json
import threading
import uuid
from datetime import datetime, timezone

from app.db.adapter import USE_POSTGRES, PH, make_pg_conn, fetch_all, fetch_one

_local = threading.local()


def _conn():
    if not hasattr(_local, "conn") or _local.conn is None:
        if USE_POSTGRES:
            _local.conn = make_pg_conn()
        else:
            import sqlite3
            from app.db.paths import DATA_DIR
            conn = sqlite3.connect(str(DATA_DIR / "scraper.db"), check_same_thread=False)
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
    _ex("""
        CREATE TABLE IF NOT EXISTS daily_sessions (
            session_id       TEXT PRIMARY KEY,
            started_at       TEXT NOT NULL,
            completed_at     TEXT,
            status           TEXT NOT NULL DEFAULT 'running',
            phase            TEXT NOT NULL DEFAULT 'market_discovery',
            markets_total    INTEGER DEFAULT 0,
            markets_done     INTEGER DEFAULT 0,
            markets_errors   INTEGER DEFAULT 0,
            asins_total      INTEGER DEFAULT 0,
            asins_done       INTEGER DEFAULT 0,
            asins_errors     INTEGER DEFAULT 0,
            products_updated INTEGER DEFAULT 0,
            products_new     INTEGER DEFAULT 0,
            markets_changed  INTEGER DEFAULT 0,
            total_duration_s REAL
        )
    """)
    _commit()


def start_session() -> str:
    """Create a new daily session and return its session_id. Raises if one is already running."""
    existing = get_current_session()
    if existing and existing.get("status") == "running":
        raise RuntimeError("Daily run already in progress")
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    _ex(
        f"INSERT INTO daily_sessions (session_id, started_at, status, phase) VALUES ({PH},{PH},{PH},{PH})",
        (session_id, now, "running", "market_discovery"),
    )
    _commit()
    return session_id


def update_session(session_id: str, **kwargs) -> None:
    """Update any subset of session fields."""
    allowed = {
        "phase", "markets_total", "markets_done", "markets_errors",
        "asins_total", "asins_done", "asins_errors",
        "products_updated", "products_new", "markets_changed",
    }
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return
    set_clause = ", ".join(f"{k} = {PH}" for k in updates)
    _ex(
        f"UPDATE daily_sessions SET {set_clause} WHERE session_id = {PH}",
        (*updates.values(), session_id),
    )
    _commit()


def complete_session(session_id: str, status: str, total_duration_s: float, **stats) -> None:
    now = datetime.now(timezone.utc).isoformat()
    allowed_stats = {
        "products_updated", "products_new", "markets_changed",
        "markets_done", "markets_errors", "asins_done", "asins_errors",
    }
    extra = {k: v for k, v in stats.items() if k in allowed_stats}
    extra_set = "".join(f", {k} = {PH}" for k in extra)
    _ex(
        f"UPDATE daily_sessions SET status={PH}, completed_at={PH}, total_duration_s={PH}, phase={PH}{extra_set} WHERE session_id={PH}",
        (status, now, total_duration_s, "done", *extra.values(), session_id),
    )
    _commit()


def get_current_session() -> dict | None:
    """Return the currently running session, or the most recent completed one."""
    cur = _ex(
        "SELECT * FROM daily_sessions ORDER BY started_at DESC LIMIT 1"
    )
    row = fetch_one(cur)
    return dict(row) if row else None


def get_running_session() -> dict | None:
    cur = _ex(f"SELECT * FROM daily_sessions WHERE status = {PH} LIMIT 1", ("running",))
    row = fetch_one(cur)
    return dict(row) if row else None


def get_history(limit: int = 30) -> list[dict]:
    cur = _ex(
        f"SELECT * FROM daily_sessions ORDER BY started_at DESC LIMIT {PH}", (limit,)
    )
    return [dict(r) for r in fetch_all(cur)]


def clear_history() -> int:
    """Delete all completed/failed daily sessions. Returns number of deleted rows."""
    cur = _ex(f"DELETE FROM daily_sessions WHERE status != {PH}", ("running",))
    return cur.rowcount
