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
    """Flush buffered writes from local cache to Supabase."""
    db = get_db()
    if not db:
        return 0

    pending = cache.get_pending_writes()
    if not pending:
        return 0

    flushed_ids = []
    for write in pending:
        try:
            if write["operation"] == "insert":
                db.insert(write["table"], write["data"])
            elif write["operation"] == "upsert":
                db.upsert(write["table"], write["data"])
            elif write["operation"] == "update":
                data = dict(write["data"])
                match = data.pop("_match", {})
                db.update(write["table"], data, match)
            flushed_ids.append(write["id"])
        except Exception:
            break  # Stop on first failure

    if flushed_ids:
        cache.mark_flushed(flushed_ids)
        log.info("cache_flushed", count=len(flushed_ids))

    return len(flushed_ids)
