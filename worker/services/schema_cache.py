"""Process-level cache for Supabase schema probes.

Why
───
Some worker modules SELECT from tables that may be missing in the live
Supabase project, or that exist but lack a few columns the worker code
expects (legacy column names, planned-but-never-shipped fields, etc.).

PostgREST returns 400 Bad Request for both "missing relation" (PGRST205)
and "missing column" (42703 / PGRST204). Our existing `safe_select` swallows
the exception but still logs a `supabase_select_failed` warning on every
single attempt. With the worker daemon running multiple loops every few
minutes, a single broken query can produce dozens of warning lines per
hour and bury real errors.

This module adds a tiny once-per-process probe :

    if table_exists("moments"):
        safe_select("moments", "...")

    if table_exists("moments", columns="id,start_epoch"):
        safe_select("moments", "id,start_epoch,...")

The first call hits Supabase with `?select={columns}&limit=0` ; the result
(boolean) is memoised for the lifetime of the process. Subsequent calls
return instantly and never touch the network.

If the probe itself errors (network down, 500), we fall back to "exists =
True" so we don't accidentally hide a transient outage as a permanent
schema problem. The real `safe_select` call will still run and log the
underlying error if the outage persists.
"""

from __future__ import annotations

import threading

import structlog

from services.supabase_client import get_db

log = structlog.get_logger()


# Cache key = (table, normalised columns string). None columns = "*"
_cache: dict[tuple[str, str], bool] = {}
_lock = threading.Lock()


def _probe(table: str, columns: str | None) -> bool:
    """Run the actual HTTP HEAD-equivalent : `?select={cols}&limit=0`.

    Returns True if PostgREST accepts the query (200/206), False if it
    returns a 4xx that means "schema mismatch" (404, 400 with PGRST205 /
    PGRST204 / 42703). Any other error path → True (don't suppress real
    queries on transient failures).
    """
    db = get_db()
    if db is None:
        # No Supabase configured — local-only mode. Skip silently.
        return False

    cols = columns or "id"
    try:
        r = db._get_client().get(
            f"{db.base}/{table}",
            params={"select": cols, "limit": 0},
        )
    except Exception as e:
        # Network / DNS / timeout — assume table exists, let the real
        # query path handle it (and log) if the issue persists.
        log.debug("schema_probe_transient", table=table, error=str(e)[:120])
        return True

    if r.status_code in (200, 206):
        return True

    if r.status_code in (400, 404):
        body = r.text[:300]
        # Permanent schema mismatch signatures
        for sig in ('"PGRST205"', '"PGRST204"', '"42703"', '"42P01"'):
            if sig in body:
                log.debug(
                    "schema_probe_missing",
                    table=table,
                    columns=cols,
                    code=r.status_code,
                    signature=sig,
                )
                return False
        # Other 4xx (e.g. RLS policy issue) — treat as exists, surface
        # the real error via the normal call path.
        return True

    # 5xx etc. — transient
    return True


def table_exists(name: str, columns: str | None = None) -> bool:
    """Return True if `name` is a queryable PostgREST resource.

    When `columns` is provided, also validates that EVERY column in the
    list is selectable. This is the recommended form for code that
    queries a specific column set, because PostgREST 400s on missing
    columns the same way it 400s on missing tables.

    Result is cached for the lifetime of the process. The cache lives
    in-memory only ; restarting the worker re-probes.
    """
    key = (name, columns or "*")
    with _lock:
        if key in _cache:
            return _cache[key]
    result = _probe(name, columns)
    with _lock:
        _cache[key] = result
    return result


def reset_cache() -> None:
    """Clear the probe cache. Mostly for tests."""
    with _lock:
        _cache.clear()
