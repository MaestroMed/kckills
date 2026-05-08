"""
Supabase REST client (httpx-based) with local cache fallback.

Talks directly to the PostgREST API exposed by Supabase instead of going
through the supabase-py SDK. The SDK pulls in pyiceberg which requires a
Rust toolchain to build on Windows and frequently fails install.

This implementation only needs httpx (already a worker dep) and exposes
the same interface: get_db / safe_insert / safe_update / safe_select /
flush_cache.
"""

from __future__ import annotations

import httpx
import structlog
from config import config
from local_cache import cache

log = structlog.get_logger()


class SupabaseRest:
    """Minimal PostgREST client for Supabase."""

    def __init__(self, url: str, service_key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        self._client: httpx.Client | None = None

    def _get_client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(headers=self.headers, timeout=20.0)
        return self._client

    def insert(self, table: str, data: dict) -> dict | None:
        r = self._get_client().post(f"{self.base}/{table}", json=data)
        r.raise_for_status()
        rows = r.json()
        return rows[0] if rows else None

    def upsert(self, table: str, data: dict, on_conflict: str | None = None) -> dict | None:
        headers = {**self.headers, "Prefer": "return=representation,resolution=merge-duplicates"}
        params = {"on_conflict": on_conflict} if on_conflict else None
        r = self._get_client().post(
            f"{self.base}/{table}",
            json=data,
            headers=headers,
            params=params,
        )
        r.raise_for_status()
        rows = r.json()
        return rows[0] if rows else None

    def update(self, table: str, data: dict, filters: dict) -> bool:
        # Build PostgREST filter query: col=eq.value
        params = {k: f"eq.{v}" for k, v in filters.items()}
        r = self._get_client().patch(f"{self.base}/{table}", json=data, params=params)
        r.raise_for_status()
        return True

    def select(self, table: str, columns: str = "*", filters: dict | None = None) -> list[dict]:
        params = {"select": columns}
        if filters:
            for k, v in filters.items():
                params[k] = f"eq.{v}"
        r = self._get_client().get(f"{self.base}/{table}", params=params)
        r.raise_for_status()
        return r.json() or []

    def close(self):
        if self._client is not None:
            self._client.close()
            self._client = None


_db: SupabaseRest | None = None


def get_db() -> SupabaseRest | None:
    global _db
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_KEY:
        return None
    if _db is None:
        try:
            _db = SupabaseRest(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)
        except Exception as e:
            log.error("supabase_connect_failed", error=str(e))
            return None
    return _db


def close_db() -> None:
    """Wave 27.2 — close the pooled Supabase client at shutdown.

    Idempotent. main.py's `finally` calls this alongside http_pool's
    close_all() so we don't leave keep-alive sockets dangling when the
    worker exits.
    """
    global _db
    if _db is not None:
        try:
            _db.close()
        except Exception as e:
            log.warn("supabase_close_failed", error=str(e)[:160])
        _db = None


def safe_insert(table: str, data: dict) -> dict | None:
    """Insert with fallback to local cache if Supabase is down."""
    db = get_db()
    if db:
        try:
            return db.insert(table, data)
        except httpx.HTTPStatusError as e:
            log.warn(
                "supabase_insert_http_error",
                table=table,
                status=e.response.status_code,
                body=e.response.text[:400],
            )
        except Exception as e:
            log.warn("supabase_insert_failed", table=table, error=str(e))
    cache.buffer_write(table, "insert", data)
    return None


def safe_upsert(table: str, data: dict, on_conflict: str | None = None) -> dict | None:
    db = get_db()
    if db:
        try:
            return db.upsert(table, data, on_conflict=on_conflict)
        except httpx.HTTPStatusError as e:
            log.warn(
                "supabase_upsert_http_error",
                table=table,
                status=e.response.status_code,
                body=e.response.text[:400],
            )
        except Exception as e:
            log.warn("supabase_upsert_failed", table=table, error=str(e))
    cache.buffer_write(table, "upsert", data)
    return None


def safe_update(table: str, data: dict, match_col: str, match_val: str) -> bool:
    """Update with fallback to local cache."""
    db = get_db()
    if db:
        try:
            db.update(table, data, {match_col: match_val})
            return True
        except httpx.HTTPStatusError as e:
            log.warn(
                "supabase_update_http_error",
                table=table,
                status=e.response.status_code,
                body=e.response.text[:400],
            )
        except Exception as e:
            log.warn("supabase_update_failed", table=table, error=str(e))
    cache.buffer_write(table, "update", {**data, "_match": {match_col: match_val}})
    return False


def safe_select(table: str, columns: str = "*", **filters) -> list[dict]:
    """Select with empty list on failure."""
    db = get_db()
    if not db:
        return []
    try:
        return db.select(table, columns=columns, filters=filters)
    except Exception as e:
        log.warn("supabase_select_failed", table=table, error=str(e))
        return []


async def flush_cache():
    """Flush buffered writes from local cache to Supabase.

    PR8 hardening : the original implementation broke on the FIRST error,
    so a single bad row (e.g. a stale cached UPDATE that references a
    transient column like `_local_h_path` which the live code now strips)
    would block ALL subsequent flushes — leading to the 984-pending
    backlog observed in production.

    The new flush :
      * Sanitises each row before sending (strips known-transient keys
        like `_local_h_path` that were leaked into older cached writes).
      * Categorises HTTP errors :
          - 4xx with code 23514 (CHECK constraint), 42703 (column does
            not exist) or PGRST204 (column not in schema) = permanent ;
            mark the row as flushed (drop it) so it stops blocking.
          - Other errors (5xx, network, timeout) = transient ; leave the
            row pending and continue with the next one.
      * NEVER aborts the batch on a single failure.

    Returns the count of rows successfully flushed (or dropped as
    permanently bad).
    """
    db = get_db()
    if not db:
        return 0

    pending = cache.get_pending_writes()
    if not pending:
        return 0

    flushed_ids: list[str] = []
    permanently_bad_ids: list[str] = []
    transient_failures = 0
    transient_failure_codes: list[int] = []

    # Columns that are private to in-process pipelines and must never
    # reach Supabase. Cached writes from older builds may still carry
    # them ; we strip on flush as a belt-and-braces guard.
    TRANSIENT_KEYS = {"_local_h_path", "_match"}

    for write in pending:
        wid = write["id"]
        op = write["operation"]
        table = write["table"]
        raw = write["data"] or {}
        try:
            if op == "insert":
                data = {k: v for k, v in raw.items() if k not in TRANSIENT_KEYS}
                db.insert(table, data)
            elif op == "upsert":
                data = {k: v for k, v in raw.items() if k not in TRANSIENT_KEYS}
                db.upsert(table, data)
            elif op == "update":
                data = dict(raw)
                match = data.pop("_match", {})
                # Strip transient keys from the data payload (NOT the
                # match clause, which is always {col: val}).
                data = {k: v for k, v in data.items() if k not in TRANSIENT_KEYS}
                if not match:
                    permanently_bad_ids.append(wid)
                    continue
                db.update(table, data, match)
            else:
                permanently_bad_ids.append(wid)
                continue
            flushed_ids.append(wid)
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            body = e.response.text[:200]
            # Permanent errors : invalid column, CHECK violation, FK
            # violation, schema cache miss. These will NEVER succeed on
            # retry — drop the row so the queue can drain.
            permanent_signatures = (
                '"42703"',          # column does not exist
                '"23514"',          # CHECK constraint violation
                '"23502"',          # NOT NULL violation (data shape bug)
                '"23503"',          # FK violation (referenced row gone)
                '"PGRST204"',       # column not in schema cache
                '"PGRST205"',       # table not in schema cache
            )
            if status >= 400 and status < 500 and any(sig in body for sig in permanent_signatures):
                permanently_bad_ids.append(wid)
                log.warn(
                    "cache_flush_drop_permanent",
                    table=table, op=op, status=status, body=body[:120],
                )
            else:
                transient_failures += 1
                transient_failure_codes.append(status)
                # Continue to next row — DON'T break the batch.
        except Exception as e:
            # Network / timeout / unknown — transient, leave for next cycle.
            transient_failures += 1
            log.warn(
                "cache_flush_transient_error",
                table=table, op=op, error=str(e)[:120],
            )

    # Mark both successfully-flushed AND permanently-bad rows as done so
    # the cache drains. Permanently-bad get a separate log signal so we
    # can audit later if a real bug emerges.
    drained = list(set(flushed_ids + permanently_bad_ids))
    if drained:
        cache.mark_flushed(drained)
        log.info(
            "cache_flushed",
            ok=len(flushed_ids),
            dropped=len(permanently_bad_ids),
            transient_failures=transient_failures,
            transient_codes=sorted(set(transient_failure_codes))[:5],
        )
    return len(flushed_ids)

    return len(flushed_ids)
