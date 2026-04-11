"""Supabase client wrapper with local cache fallback."""

import structlog
from supabase import create_client, Client
from config import config
from local_cache import cache

log = structlog.get_logger()
_client: Client | None = None


def get_db() -> Client | None:
    global _client
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_KEY:
        return None
    if _client is None:
        try:
            _client = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)
        except Exception as e:
            log.error("supabase_connect_failed", error=str(e))
            return None
    return _client


def safe_insert(table: str, data: dict) -> dict | None:
    """Insert with fallback to local cache if Supabase is down."""
    db = get_db()
    if db:
        try:
            result = db.table(table).insert(data).execute()
            return result.data[0] if result.data else None
        except Exception as e:
            log.warn("supabase_insert_failed", table=table, error=str(e))
    # Fallback: buffer locally
    cache.buffer_write(table, "insert", data)
    return None


def safe_update(table: str, data: dict, match_col: str, match_val: str) -> bool:
    """Update with fallback to local cache."""
    db = get_db()
    if db:
        try:
            db.table(table).update(data).eq(match_col, match_val).execute()
            return True
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
        q = db.table(table).select(columns)
        for col, val in filters.items():
            q = q.eq(col, val)
        result = q.execute()
        return result.data or []
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
                db.table(write["table"]).insert(write["data"]).execute()
            elif write["operation"] == "update":
                data = dict(write["data"])
                match = data.pop("_match", {})
                for col, val in match.items():
                    db.table(write["table"]).update(data).eq(col, val).execute()
            flushed_ids.append(write["id"])
        except Exception:
            break  # Stop on first failure

    if flushed_ids:
        cache.mark_flushed(flushed_ids)
        log.info("cache_flushed", count=len(flushed_ids))

    return len(flushed_ids)
