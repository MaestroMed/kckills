"""Tests Wave 34 T3.1 — Cross-process quota coordination via Postgres.

Couverture :
  * _get_shared_count : retourne le tuple (count, cost) cached 5s
  * _record_call_shared : appelle l'RPC et met à jour le cache
  * wait_for : prend le max(local, shared) — refuse si shared >= cap
  * record_cost : schedule un bump asynchrone via le RPC
  * Fallback in-memory si RPC fail (DB down / Supabase off)

Tous les RPC sont mockés via patch sur scheduler._get_db. Aucun appel
réseau réel.
"""

from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import patch, MagicMock

import pytest

# worker root → sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


# ════════════════════════════════════════════════════════════════════
# Mock helpers
# ════════════════════════════════════════════════════════════════════


def _mock_db_returning(rpc_response: list | dict | None):
    """Construit un mock du db `SupabaseRest` qui simule un POST RPC.

    `rpc_response` est ce que PostgREST renverrait via `r.json()`.
    """
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json = MagicMock(return_value=rpc_response)

    mock_client = MagicMock()
    mock_client.post = MagicMock(return_value=mock_response)

    mock_db = MagicMock()
    mock_db._get_client = MagicMock(return_value=mock_client)
    mock_db.base = "https://example.supabase.co/rest/v1"
    return mock_db, mock_client


def _mock_db_raising(exc: Exception):
    """Mock db dont l'appel `client.post` raise une exception (RPC down)."""
    mock_client = MagicMock()
    mock_client.post = MagicMock(side_effect=exc)
    mock_db = MagicMock()
    mock_db._get_client = MagicMock(return_value=mock_client)
    mock_db.base = "https://example.supabase.co/rest/v1"
    return mock_db


# ════════════════════════════════════════════════════════════════════
# _get_shared_count
# ════════════════════════════════════════════════════════════════════


def test_get_shared_count_returns_count_and_cost():
    """fn_worker_quota_get → (count, cost) parsed correctly."""
    from scheduler import LoLTokScheduler

    mock_db, _ = _mock_db_returning([{"call_count": 42, "cost_usd": 1.25}])

    async def run():
        s = LoLTokScheduler()
        with patch.object(s, "_get_db", return_value=mock_db):
            result = await s._get_shared_count("gemini")
        return result

    result = asyncio.run(run())
    assert result == (42, 1.25)


def test_get_shared_count_cached_within_ttl():
    """Second call within TTL must NOT re-hit the RPC."""
    from scheduler import LoLTokScheduler

    mock_db, mock_client = _mock_db_returning([{"call_count": 10, "cost_usd": 0.5}])

    async def run():
        s = LoLTokScheduler()
        # Pin a long TTL so the second call falls inside the window.
        s.SHARED_LOOKUP_TTL_SECONDS = 60.0
        with patch.object(s, "_get_db", return_value=mock_db):
            r1 = await s._get_shared_count("gemini")
            r2 = await s._get_shared_count("gemini")
        return r1, r2, mock_client.post.call_count

    r1, r2, call_count = asyncio.run(run())
    assert r1 == (10, 0.5)
    assert r2 == (10, 0.5)
    # Only ONE RPC call — second came from cache.
    assert call_count == 1


def test_get_shared_count_returns_zero_when_row_missing():
    """fn_worker_quota_get retourne (0, 0) si la row n'existe pas."""
    from scheduler import LoLTokScheduler

    mock_db, _ = _mock_db_returning([{"call_count": 0, "cost_usd": 0}])

    async def run():
        s = LoLTokScheduler()
        with patch.object(s, "_get_db", return_value=mock_db):
            return await s._get_shared_count("gemini")

    result = asyncio.run(run())
    assert result == (0, 0.0)


def test_get_shared_count_returns_none_on_rpc_failure():
    """RPC raises → returns None so wait_for falls back to in-memory."""
    from scheduler import LoLTokScheduler

    mock_db = _mock_db_raising(RuntimeError("network down"))

    async def run():
        s = LoLTokScheduler()
        with patch.object(s, "_get_db", return_value=mock_db):
            return await s._get_shared_count("gemini")

    assert asyncio.run(run()) is None


def test_get_shared_count_returns_none_when_db_unavailable():
    """get_db() returns None (env vars missing) → no RPC call, None back."""
    from scheduler import LoLTokScheduler

    async def run():
        s = LoLTokScheduler()
        with patch.object(s, "_get_db", return_value=None):
            return await s._get_shared_count("gemini")

    assert asyncio.run(run()) is None


# ════════════════════════════════════════════════════════════════════
# _record_call_shared
# ════════════════════════════════════════════════════════════════════


def test_record_call_shared_posts_and_caches():
    """RPC call bumps the cache so the next _get_shared_count is a hit."""
    from scheduler import LoLTokScheduler

    mock_db, mock_client = _mock_db_returning([{"call_count": 5, "cost_usd": 0.10}])

    async def run():
        s = LoLTokScheduler()
        s.SHARED_LOOKUP_TTL_SECONDS = 60.0
        with patch.object(s, "_get_db", return_value=mock_db):
            result = await s._record_call_shared("gemini", cost_usd=0.10)
            # Next get_shared_count must NOT re-hit RPC — should see cache
            cached = await s._get_shared_count("gemini")
        return result, cached, mock_client.post.call_count

    result, cached, call_count = asyncio.run(run())
    assert result == (5, 0.10)
    assert cached == (5, 0.10)
    # Only 1 POST (the record_call_shared), the get_shared_count hit cache.
    assert call_count == 1


def test_record_call_shared_returns_none_on_failure():
    """RPC down → record_call_shared returns None silently."""
    from scheduler import LoLTokScheduler

    mock_db = _mock_db_raising(RuntimeError("supabase 503"))

    async def run():
        s = LoLTokScheduler()
        with patch.object(s, "_get_db", return_value=mock_db):
            return await s._record_call_shared("gemini", cost_usd=0.05)

    assert asyncio.run(run()) is None


# ════════════════════════════════════════════════════════════════════
# wait_for : shared ledger participates in cap check
# ════════════════════════════════════════════════════════════════════


def test_wait_for_refuses_when_shared_count_at_cap():
    """Shared ledger says N >= cap → wait_for refuses even with local=0.

    Reproduces the cross-process overshoot scenario : the local process
    hasn't called Gemini yet, but a sibling child already maxed out the
    quota. Pre-Wave-34 this returned True (overshoot). Now it returns
    False.
    """
    from scheduler import LoLTokScheduler

    mock_db, _ = _mock_db_returning([{"call_count": 950, "cost_usd": 0.0}])

    async def run():
        s = LoLTokScheduler()
        # Cap = 950, in-memory count = 0, but the shared ledger says 950.
        s.DAILY_QUOTAS = {"gemini": 950}
        with patch.object(s, "_get_db", return_value=mock_db):
            return await s.wait_for("gemini")

    assert asyncio.run(run()) is False


def test_wait_for_accepts_when_shared_count_below_cap():
    """Shared count < cap → wait_for admits the call (with delay obeyed)."""
    from scheduler import LoLTokScheduler

    mock_db, _ = _mock_db_returning([{"call_count": 100, "cost_usd": 0.0}])

    async def run():
        s = LoLTokScheduler()
        s.DAILY_QUOTAS = {"gemini": 950}
        s.DELAYS["gemini"] = 0.01  # speed up test
        with patch.object(s, "_get_db", return_value=mock_db):
            return await s.wait_for("gemini")

    assert asyncio.run(run()) is True


def test_wait_for_takes_max_of_local_and_shared():
    """Local count > shared (RPC stale) → uses local. Defensive."""
    from scheduler import LoLTokScheduler

    # Shared says 50, but local already saw 950 calls. Use local.
    mock_db, _ = _mock_db_returning([{"call_count": 50, "cost_usd": 0.0}])

    async def run():
        s = LoLTokScheduler()
        s.DAILY_QUOTAS = {"gemini": 950}
        s._daily_counts["gemini"] = 950
        with patch.object(s, "_get_db", return_value=mock_db):
            return await s.wait_for("gemini")

    assert asyncio.run(run()) is False


def test_wait_for_refuses_when_shared_cost_exceeds_cap():
    """Shared cost > cap, local cost = 0 → wait_for refuses."""
    from scheduler import LoLTokScheduler

    mock_db, _ = _mock_db_returning([{"call_count": 1, "cost_usd": 15.0}])

    async def run():
        s = LoLTokScheduler()
        s.DAILY_COST_CAPS_USD = {"gemini": 10.0}
        s.DAILY_QUOTAS = {"gemini": 99999}  # don't block on count
        with patch.object(s, "_get_db", return_value=mock_db):
            return await s.wait_for("gemini")

    assert asyncio.run(run()) is False


def test_wait_for_falls_back_to_inmemory_when_rpc_down():
    """RPC fails → use in-memory count. Pre-Wave-34 behaviour preserved."""
    from scheduler import LoLTokScheduler

    mock_db = _mock_db_raising(RuntimeError("DB down"))

    async def run():
        s = LoLTokScheduler()
        s.DAILY_QUOTAS = {"gemini": 950}
        s.DELAYS["gemini"] = 0.01
        # In-memory count is below cap.
        s._daily_counts["gemini"] = 100
        with patch.object(s, "_get_db", return_value=mock_db):
            return await s.wait_for("gemini")

    # Should accept — RPC failure shouldn't block the worker.
    assert asyncio.run(run()) is True


def test_wait_for_no_db_skips_shared_check():
    """get_db returns None (no Supabase env) → only in-memory checks."""
    from scheduler import LoLTokScheduler

    async def run():
        s = LoLTokScheduler()
        s.DAILY_QUOTAS = {"gemini": 950}
        s.DELAYS["gemini"] = 0.01
        with patch.object(s, "_get_db", return_value=None):
            return await s.wait_for("gemini")

    assert asyncio.run(run()) is True


# ════════════════════════════════════════════════════════════════════
# record_cost : shared bump via RPC
# ════════════════════════════════════════════════════════════════════


def test_record_cost_schedules_shared_bump():
    """record_cost calls _record_call_shared with the cost via a task.

    Verifies the wiring: record_cost is a sync function, but inside an
    asyncio loop it must schedule the shared bump as a Task.
    """
    from scheduler import LoLTokScheduler

    captured: list[tuple[str, float]] = []

    async def fake_record(self, service, cost_usd=0.0):
        captured.append((service, cost_usd))
        return (1, cost_usd)

    async def run():
        s = LoLTokScheduler()
        with patch.object(
            LoLTokScheduler,
            "_record_call_shared",
            fake_record,
        ):
            s.record_cost("gemini", 0.075)
            # Yield to the event loop so the scheduled task runs.
            await asyncio.sleep(0)
            await asyncio.sleep(0)

    asyncio.run(run())
    assert captured == [("gemini", 0.075)]


def test_record_cost_no_loop_skips_shared_bump_silently():
    """Sync caller (no running loop) → no crash, in-memory still updates."""
    from scheduler import LoLTokScheduler

    s = LoLTokScheduler()
    # No event loop running — call from sync context.
    s.record_cost("gemini", 0.5)
    # In-memory ledger captured the spend.
    assert s._daily_cost_usd["gemini"] == pytest.approx(0.5, rel=1e-6)


def test_record_cost_negative_ignored():
    """Negative cost → silent no-op. Same behaviour as Wave 33."""
    from scheduler import LoLTokScheduler

    s = LoLTokScheduler()
    s.record_cost("gemini", -1.0)
    assert s._daily_cost_usd.get("gemini", 0.0) == 0.0


# ════════════════════════════════════════════════════════════════════
# Cache TTL behaviour
# ════════════════════════════════════════════════════════════════════


def test_shared_cache_expires_after_ttl():
    """After TTL expires, the next _get_shared_count re-hits the RPC."""
    from scheduler import LoLTokScheduler

    # First call returns 10, second call returns 20 (a sibling bumped).
    responses = iter([
        [{"call_count": 10, "cost_usd": 0.1}],
        [{"call_count": 20, "cost_usd": 0.2}],
    ])

    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json = MagicMock(side_effect=lambda: next(responses))
    mock_client = MagicMock()
    mock_client.post = MagicMock(return_value=mock_response)
    mock_db = MagicMock()
    mock_db._get_client = MagicMock(return_value=mock_client)
    mock_db.base = "https://example.supabase.co/rest/v1"

    async def run():
        s = LoLTokScheduler()
        s.SHARED_LOOKUP_TTL_SECONDS = 0.05  # 50ms TTL
        with patch.object(s, "_get_db", return_value=mock_db):
            r1 = await s._get_shared_count("gemini")
            await asyncio.sleep(0.1)  # wait past TTL
            r2 = await s._get_shared_count("gemini")
        return r1, r2

    r1, r2 = asyncio.run(run())
    assert r1 == (10, 0.1)
    assert r2 == (20, 0.2)  # fresh read after TTL


# ════════════════════════════════════════════════════════════════════
# _current_quota_date — alignment with reset window
# ════════════════════════════════════════════════════════════════════


def test_current_quota_date_format_is_iso():
    """The date passed to the RPC must be ISO YYYY-MM-DD."""
    from scheduler import LoLTokScheduler
    import re

    s = LoLTokScheduler()
    date = s._current_quota_date()
    assert re.match(r"^\d{4}-\d{2}-\d{2}$", date), f"bad ISO date: {date}"
