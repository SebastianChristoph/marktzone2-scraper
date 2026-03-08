"""
Database adapter constants for SQLite (local) vs PostgreSQL (server).
Controlled by DATABASE_URL env var:
  - not set / empty → SQLite
  - postgresql://... → PostgreSQL via psycopg2

Each DB module manages its own connection; this module provides shared helpers.
"""
import os

DATABASE_URL = os.getenv("DATABASE_URL", "")
USE_POSTGRES = bool(DATABASE_URL and DATABASE_URL.startswith("postgresql"))

# SQL placeholder differs between backends
PH = "%s" if USE_POSTGRES else "?"


def make_pg_conn():
    import psycopg2
    import psycopg2.extras
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.autocommit = False
    return conn


def serial_pk() -> str:
    return "SERIAL PRIMARY KEY" if USE_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"


def fetch_all(cur) -> list[dict]:
    """Normalise rows from either backend to list[dict]."""
    rows = cur.fetchall()
    if not rows:
        return []
    # psycopg2 RealDictCursor already gives dicts; sqlite3.Row needs dict()
    if isinstance(rows[0], dict):
        return list(rows)
    return [dict(r) for r in rows]


def fetch_one(cur):
    row = cur.fetchone()
    if row is None:
        return None
    return row if isinstance(row, dict) else dict(row)
