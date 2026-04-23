"""
SQLite local cache — fallback when Supabase is unreachable.
Buffers writes locally and flushes when connection returns.
"""

import sqlite3
import json
import os
from config import config


class LocalCache:
    def __init__(self, db_path: str = config.CACHE_DB):
        self.db_path = db_path
        self._conn: sqlite3.Connection | None = None
        self._init_db()

    def _init_db(self):
        conn = self._get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS pending_writes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                table_name TEXT NOT NULL,
                operation TEXT NOT NULL,
                data TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                flushed BOOLEAN DEFAULT 0
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()

    def _get_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(self.db_path)
            self._conn.row_factory = sqlite3.Row
        return self._conn

    def buffer_write(self, table: str, operation: str, data: dict):
        """Buffer a write operation for later flush to Supabase."""
        conn = self._get_conn()
        conn.execute(
            "INSERT INTO pending_writes (table_name, operation, data) VALUES (?, ?, ?)",
            (table, operation, json.dumps(data)),
        )
        conn.commit()

    def get_pending_writes(self) -> list[dict]:
        """Get all unflushed writes."""
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id, table_name, operation, data FROM pending_writes WHERE flushed = 0 ORDER BY id"
        ).fetchall()
        return [
            {"id": r["id"], "table": r["table_name"], "operation": r["operation"], "data": json.loads(r["data"])}
            for r in rows
        ]

    def mark_flushed(self, ids: list[int]):
        """Mark writes as flushed."""
        if not ids:
            return
        conn = self._get_conn()
        placeholders = ",".join("?" for _ in ids)
        conn.execute(f"UPDATE pending_writes SET flushed = 1 WHERE id IN ({placeholders})", ids)
        conn.commit()

    def set(self, key: str, value):
        """Set a key-value pair."""
        conn = self._get_conn()
        conn.execute(
            "INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, datetime('now'))",
            (key, json.dumps(value)),
        )
        conn.commit()

    def get(self, key: str, default=None):
        """Get a value by key."""
        conn = self._get_conn()
        row = conn.execute("SELECT value FROM kv_store WHERE key = ?", (key,)).fetchone()
        if row:
            return json.loads(row["value"])
        return default

    def pending_count(self) -> int:
        conn = self._get_conn()
        row = conn.execute("SELECT COUNT(*) as c FROM pending_writes WHERE flushed = 0").fetchone()
        return row["c"]

    # Alias to match LocalCacheRedis public API.
    count_pending = pending_count


def get_cache():
    """Return Redis-backed cache if KCKILLS_USE_REDIS=1 and reachable, else SQLite.

    The Redis backend is required for the orchestrator's process-split
    architecture (4 child processes hammering the cache concurrently
    cause SQLite write-lock contention). For the legacy single-process
    main.py, SQLite is fine.
    """
    import structlog
    log = structlog.get_logger()
    if os.getenv("KCKILLS_USE_REDIS") == "1":
        try:
            from local_cache_redis import LocalCacheRedis
            c = LocalCacheRedis()
            c.ping()
            log.info("cache_backend_selected", backend="redis")
            return c
        except Exception as e:
            log.warn("redis_cache_unavailable_falling_back", error=str(e))
    return LocalCache()


cache = get_cache()
