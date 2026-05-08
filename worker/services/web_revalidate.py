"""web_revalidate — Wave 15 (2026-05-08)

Tell the web frontend to invalidate cached homepage data after a
worker write that affects the hero card (last match, KC kill count,
top scorer, career stats).

Hits POST /api/revalidate/hero-stats on kckills.com with a shared
token. Fire-and-forget : if the call fails, we just log a warn and
keep going — the 5-minute TTL on `unstable_cache` is the safety net.

Env :
    KCKILLS_WEB_REVALIDATE_URL  Full URL of the endpoint, e.g.
        https://kckills.com/api/revalidate/hero-stats
    KCKILLS_REVALIDATE_TOKEN    Shared secret. MUST match the value
        in web/.env.local. Generate with `openssl rand -hex 32`.

When either var is unset, the call is a no-op — useful in dev when
the local web dev server isn't reachable from the worker.
"""
from __future__ import annotations

import os

import httpx
import structlog

log = structlog.get_logger()

_URL = os.getenv("KCKILLS_WEB_REVALIDATE_URL", "")
_TOKEN = os.getenv("KCKILLS_REVALIDATE_TOKEN", "")


async def revalidate_hero_stats() -> None:
    """Invalidate the homepage hero-stats cache. Fire-and-forget."""
    if not _URL or not _TOKEN:
        return
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.post(_URL, json={"token": _TOKEN})
            if r.status_code != 200:
                log.warn("web_revalidate_failed", status=r.status_code)
    except Exception as e:
        log.warn("web_revalidate_error", error=str(e)[:200])
