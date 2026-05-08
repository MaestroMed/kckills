"""http_pool — Wave 27.2 (2026-05-08)

Shared httpx.AsyncClient pool for hot-path API clients.

Each named client is a process-wide singleton : created lazily on first
call, reused across the worker's lifetime, closed at shutdown.

Why
---
Creating a fresh `httpx.AsyncClient` on every call burns a TCP handshake
+ TLS session per request. The hot-path callers — livestats_api,
lolesports_api — hit their endpoints every ~10s during live matches,
which compounds to 8000+ unnecessary handshakes a day. With a keep-alive
pool, a single TCP connection serves the whole match.

Lifecycle
---------
* :func:`get(name, **kwargs)` returns the named client, lazily creating
  it on first call. ``kwargs`` (timeout, headers, limits, base_url, ...)
  are forwarded to ``httpx.AsyncClient`` ONLY on first creation. They're
  ignored on subsequent calls — pass them on the first call.
* :func:`close_all` closes every client. Called once from the worker's
  shutdown path (main.py atexit handler).

Concurrency
-----------
Single-threaded asyncio guarantees no race on the None-check + assign
pattern below. We never `await` between the lookup and the assignment,
so two coroutines can't race to create competing clients.
"""

from __future__ import annotations

import httpx
import structlog

log = structlog.get_logger()

_clients: dict[str, httpx.AsyncClient] = {}


def get(name: str, **kwargs) -> httpx.AsyncClient:
    """Return the named pooled client, creating it on first call.

    ``kwargs`` (timeout, headers, limits, base_url, transport, ...) are
    forwarded to :class:`httpx.AsyncClient` ONLY on first creation.
    Pass them on the first call ; subsequent calls return the cached
    client and ignore the kwargs.

    If a previously-pooled client got closed (e.g. by an explicit
    ``close_all()`` followed by another request), we transparently
    re-create it.
    """
    client = _clients.get(name)
    if client is None or client.is_closed:
        client = httpx.AsyncClient(**kwargs)
        _clients[name] = client
    return client


async def close_all() -> None:
    """Close every pooled client. Idempotent — safe to call twice."""
    for name, client in list(_clients.items()):
        try:
            if not client.is_closed:
                await client.aclose()
        except Exception as e:
            log.warn(
                "http_pool_close_failed",
                name=name,
                error=str(e)[:160],
            )
    _clients.clear()
