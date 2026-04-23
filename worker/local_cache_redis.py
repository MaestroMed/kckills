"""
Redis-backed local cache — drop-in alternative to local_cache.LocalCache.

Designed for the multi-process worker architecture where SQLite's single-writer
lock becomes a bottleneck. One LIST per table gives FIFO ordering and atomic
LPUSH/RPOP for race-safety across processes.

Public API matches LocalCache: buffer_write, get_pending_writes, mark_flushed,
count_pending. Also exposes ping() for the factory health-check.
"""

from __future__ import annotations

import json
import os
import time
import uuid

import redis
import structlog

log = structlog.get_logger()


# Module-level pool, shared by all LocalCacheRedis instances in this process.
_POOL: redis.ConnectionPool | None = None


def _get_pool() -> redis.ConnectionPool:
    global _POOL
    if _POOL is None:
        _POOL = redis.ConnectionPool(
            host=os.getenv("KCKILLS_REDIS_HOST", "localhost"),
            port=int(os.getenv("KCKILLS_REDIS_PORT", "6379")),
            db=int(os.getenv("KCKILLS_REDIS_DB", "2")),
            decode_responses=True,
            socket_timeout=5,
            socket_connect_timeout=2,
            max_connections=20,
        )
    return _POOL


# Key conventions
_QUEUE_PREFIX = "kckills:cache:"          # + {table}:queue (LIST)
_TABLES_SET = "kckills:cache:tables"      # SET of known table names
_FLUSHED_DEDUPE = "kckills:cache:meta:flushed"  # SORTED SET (id -> ts), TTL 1h
_FLUSHED_TTL = 3600


def _queue_key(table: str) -> str:
    return f"{_QUEUE_PREFIX}{table}:queue"


class LocalCacheRedis:
    """Redis-backed write buffer. Same API as LocalCache."""

    def __init__(self):
        self.r = redis.Redis(connection_pool=_get_pool())

    # ---- health ---------------------------------------------------------
    def ping(self) -> bool:
        return bool(self.r.ping())

    # ---- buffered writes ------------------------------------------------
    def buffer_write(self, table: str, operation: str, data: dict) -> str:
        """Buffer a write operation. Returns the write_id."""
        write_id = uuid.uuid4().hex
        payload = json.dumps(
            {"id": write_id, "operation": operation, "data": data, "ts": time.time()},
            default=str,
        )
        pipe = self.r.pipeline(transaction=False)
        pipe.lpush(_queue_key(table), payload)
        pipe.sadd(_TABLES_SET, table)
        pipe.execute()
        return write_id

    def get_pending_writes(self) -> list[dict]:
        """Return all pending writes across all known tables, oldest-first."""
        out: list[dict] = []
        tables = self.r.smembers(_TABLES_SET) or set()
        flushed_ids = set(self.r.zrange(_FLUSHED_DEDUPE, 0, -1) or [])

        for table in tables:
            qkey = _queue_key(table)
            raw_items = self.r.lrange(qkey, 0, -1) or []
            for raw in reversed(raw_items):
                try:
                    item = json.loads(raw)
                except (ValueError, TypeError):
                    continue
                if item.get("id") in flushed_ids:
                    continue
                out.append(
                    {
                        "id": item["id"],
                        "table": table,
                        "operation": item["operation"],
                        "data": item.get("data") or {},
                        "_raw": raw,
                        "_table": table,
                    }
                )
        return out

    def mark_flushed(self, ids: list[str]) -> None:
        """Remove flushed entries from their queues + record in dedupe set."""
        if not ids:
            return
        id_set = set(ids)
        tables = self.r.smembers(_TABLES_SET) or set()
        pipe = self.r.pipeline(transaction=False)
        now = time.time()
        for table in tables:
            qkey = _queue_key(table)
            for raw in self.r.lrange(qkey, 0, -1) or []:
                try:
                    item = json.loads(raw)
                except (ValueError, TypeError):
                    continue
                if item.get("id") in id_set:
                    pipe.lrem(qkey, 1, raw)
        for wid in ids:
            pipe.zadd(_FLUSHED_DEDUPE, {wid: now})
        pipe.expire(_FLUSHED_DEDUPE, _FLUSHED_TTL)
        pipe.zremrangebyscore(_FLUSHED_DEDUPE, 0, now - _FLUSHED_TTL)
        pipe.execute()

    def count_pending(self) -> int:
        tables = self.r.smembers(_TABLES_SET) or set()
        if not tables:
            return 0
        pipe = self.r.pipeline(transaction=False)
        for table in tables:
            pipe.llen(_queue_key(table))
        return sum(pipe.execute() or [])

    # Alias for backward compatibility with LocalCache.pending_count().
    pending_count = count_pending
