"""
Persistence for scraper health monitor.
Tables:
  health_config   — configurable ASINs and keywords to test
  health_checks   — results of each automated health check run
"""
import json
import threading
from datetime import datetime, timezone

from app.db.adapter import USE_POSTGRES, PH, make_pg_conn, fetch_all, fetch_one

_local = threading.local()

DEFAULT_ASINS = ["B0FWR9H9L9", "B0FG7P8WMW"]
DEFAULT_KEYWORDS = ["creatine"]


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
        CREATE TABLE IF NOT EXISTS health_config (
            id       INTEGER PRIMARY KEY,
            asins    TEXT NOT NULL DEFAULT '[]',
            keywords TEXT NOT NULL DEFAULT '[]'
        )
    """)
    from app.db.adapter import serial_pk
    _ex(f"""
        CREATE TABLE IF NOT EXISTS health_checks (
            id           {serial_pk()},
            checked_at   TEXT NOT NULL,
            overall_ok   INTEGER NOT NULL DEFAULT 0,
            duration_s   REAL,
            details      TEXT NOT NULL DEFAULT '{{}}'
        )
    """)

    # Seed default config row if missing
    cur = _ex("SELECT id FROM health_config LIMIT 1")
    if fetch_one(cur) is None:
        _ex(
            f"INSERT INTO health_config (id, asins, keywords) VALUES (1, {PH}, {PH})",
            (json.dumps(DEFAULT_ASINS), json.dumps(DEFAULT_KEYWORDS)),
        )
    _commit()


def get_config() -> dict:
    cur = _ex("SELECT asins, keywords FROM health_config WHERE id = 1")
    row = fetch_one(cur)
    if row is None:
        return {"asins": DEFAULT_ASINS, "keywords": DEFAULT_KEYWORDS}
    return {
        "asins": json.loads(row["asins"]),
        "keywords": json.loads(row["keywords"]),
    }


def set_config(asins: list[str], keywords: list[str]) -> None:
    _ex(
        f"UPDATE health_config SET asins = {PH}, keywords = {PH} WHERE id = 1",
        (json.dumps(asins), json.dumps(keywords)),
    )
    _commit()


def save_check(overall_ok: bool, duration_s: float, details: dict) -> None:
    now = datetime.now(timezone.utc).isoformat()
    _ex(
        f"INSERT INTO health_checks (checked_at, overall_ok, duration_s, details) VALUES ({PH},{PH},{PH},{PH})",
        (now, 1 if overall_ok else 0, duration_s, json.dumps(details)),
    )
    _commit()


def get_latest_check() -> dict | None:
    cur = _ex("SELECT * FROM health_checks ORDER BY checked_at DESC LIMIT 1")
    row = fetch_one(cur)
    if row is None:
        return None
    r = dict(row)
    r["details"] = json.loads(r["details"])
    r["overall_ok"] = bool(r["overall_ok"])
    return r


def get_history(limit: int = 20) -> list[dict]:
    cur = _ex(
        f"SELECT * FROM health_checks ORDER BY checked_at DESC LIMIT {PH}", (limit,)
    )
    rows = fetch_all(cur)
    result = []
    for row in rows:
        r = dict(row)
        r["details"] = json.loads(r["details"])
        r["overall_ok"] = bool(r["overall_ok"])
        result.append(r)
    return result
