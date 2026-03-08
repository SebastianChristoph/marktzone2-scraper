"""
Persistence for completed/failed scraping jobs.
Backend: SQLite (local, default) or PostgreSQL (server, DATABASE_URL env var).
Running jobs are kept in-memory only; terminal jobs are persisted here.
"""
import json
import threading

from app.db.adapter import USE_POSTGRES, PH, make_pg_conn, serial_pk, fetch_all, fetch_one

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
    _ex(f"""
        CREATE TABLE IF NOT EXISTS jobs (
            job_id      TEXT PRIMARY KEY,
            cluster_id  INTEGER NOT NULL,
            status      TEXT    NOT NULL,
            created_at  TEXT    NOT NULL,
            data        TEXT    NOT NULL
        )
    """)
    _commit()


def save_job(job: dict) -> None:
    """Upsert a job record. Call when job reaches completed or failed."""
    if USE_POSTGRES:
        _ex(
            f"""INSERT INTO jobs (job_id, cluster_id, status, created_at, data)
               VALUES ({PH},{PH},{PH},{PH},{PH})
               ON CONFLICT(job_id) DO UPDATE SET status=EXCLUDED.status, data=EXCLUDED.data""",
            (job["job_id"], job["cluster_id"], job["status"], job["created_at"], json.dumps(job)),
        )
    else:
        _ex(
            f"""INSERT INTO jobs (job_id, cluster_id, status, created_at, data)
               VALUES ({PH},{PH},{PH},{PH},{PH})
               ON CONFLICT(job_id) DO UPDATE SET status=excluded.status, data=excluded.data""",
            (job["job_id"], job["cluster_id"], job["status"], job["created_at"], json.dumps(job)),
        )
    _commit()


def load_all_jobs() -> list[dict]:
    cur = _ex("SELECT data FROM jobs ORDER BY created_at DESC")
    return [json.loads(r["data"]) for r in fetch_all(cur)]


def delete_job(job_id: str) -> bool:
    cur = _ex(f"DELETE FROM jobs WHERE job_id = {PH}", (job_id,))
    _commit()
    return cur.rowcount > 0


def delete_completed_jobs() -> int:
    cur = _ex(f"DELETE FROM jobs WHERE status IN ({PH},{PH})", ("completed", "failed"))
    _commit()
    return cur.rowcount
