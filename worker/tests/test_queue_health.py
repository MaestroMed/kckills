"""Tests for modules/queue_health.py (Wave 6 P2 daemon).

Coverage
--------
queue_health is the 5-min cycle that :
  1. Calls fn_release_stale_pipeline_locks → returns count released
  2. For each kind in JOB_KINDS, snapshots status counts + oldest pending
     age + oldest claimed age + succeed throughput
  3. Emits warnings + Discord pings when thresholds are breached

We cover :
  * release_stale_locks unwraps PostgREST RPC scalar / list / dict shapes
  * release_stale_locks returns 0 + logs on RPC error
  * build_snapshot aggregates counts + ages correctly across kinds
  * threshold breach (oldest_pending) generates a warning entry
  * threshold breach (oldest_claimed) generates a warning entry
  * the run() entry-point invokes _safe_discord_ping for each warning
    (capped to MAX_PINGS) and is bulletproof to webhook errors
  * run() with no DB → no crash, returns dict with zero counters
  * snapshot totals sum properly across all kinds
  * _safe_discord_ping never raises even when notify_error throws

Strategy
--------
Stub get_db, the @run_logged Supabase calls, and discord_webhook.
Patch services.job_queue is NOT needed — queue_health uses raw httpx
through the db client. We mock db._get_client() to return a fake httpx
client that returns canned responses keyed on the URL/params.

NO Supabase calls leave the test process. NO Discord webhooks fire.
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

# Add worker root to sys.path before importing.
_WORKER_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _WORKER_ROOT)

# Stub env so config.py doesn't refuse to import.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")


# ─── Shared fixtures ─────────────────────────────────────────────────


@pytest.fixture
def patch_observability(monkeypatch):
    """Silence the @run_logged decorator's Supabase calls."""
    from services import observability

    monkeypatch.setattr(observability, "_try_insert_run", lambda module_name: None)
    monkeypatch.setattr(observability, "_try_update_run", lambda *a, **k: None)
    yield


def _make_response(status: int = 200, json_body=None, content_range: str | None = None):
    """Build a MagicMock that quacks like httpx.Response."""
    r = MagicMock()
    r.status_code = status
    r.json = lambda: json_body if json_body is not None else []
    r.headers = {"content-range": content_range} if content_range else {}
    if status >= 400:
        from httpx import HTTPStatusError, Request, Response
        # raise_for_status emulation that doesn't pull in real httpx machinery.
        def _raise():
            raise RuntimeError(f"HTTP {status}")
        r.raise_for_status = _raise
    else:
        r.raise_for_status = lambda: None
    return r


class FakeDb:
    """Fake SupabaseRest with a programmable router :
        responses : list of (predicate(method, url, params, json) -> bool, response_factory)
        Each request walks through the list until a predicate matches.
        Default-fallback returns a 200 + empty JSON.
    """

    def __init__(self):
        self.base = "https://example.supabase.co/rest/v1"
        self.headers = {"apikey": "k"}
        self.requests: list[dict] = []
        self.routes: list = []  # list[(predicate, factory)]

    def _record(self, method, url, params=None, json=None):
        self.requests.append({
            "method": method, "url": url,
            "params": dict(params or {}),
            "json": dict(json or {}) if isinstance(json, dict) else json,
        })

    def add_route(self, predicate, factory):
        self.routes.append((predicate, factory))

    def _route(self, method, url, params=None, json=None):
        for pred, factory in self.routes:
            try:
                if pred(method, url, params or {}, json):
                    return factory()
            except Exception:
                continue
        # Default : empty 200 with content-range = "0-0/0"
        return _make_response(200, json_body=[], content_range="0-0/0")

    def _get_client(self):
        owner = self

        class FakeClient:
            def get(_, url, params=None, headers=None):
                owner._record("GET", url, params=params)
                return owner._route("GET", url, params=params)

            def post(_, url, json=None, headers=None):
                owner._record("POST", url, params=None, json=json)
                return owner._route("POST", url, json=json)

            def patch(_, url, json=None, headers=None, params=None):
                owner._record("PATCH", url, params=params, json=json)
                return owner._route("PATCH", url, params=params, json=json)

        return FakeClient()


# ─── release_stale_locks ─────────────────────────────────────────────


def test_release_stale_locks_scalar_response():
    """RPC returns a bare integer → release_stale_locks returns it."""
    from modules import queue_health

    db = FakeDb()
    db.add_route(
        lambda m, u, p, j: m == "POST" and "fn_release_stale_pipeline_locks" in u,
        lambda: _make_response(200, json_body=42),
    )

    n = queue_health.release_stale_locks(db, max_age_minutes=60)
    assert n == 42
    # Verify the call sent the right payload.
    assert any(
        "fn_release_stale_pipeline_locks" in r["url"]
        and r["json"] == {"p_max_age_minutes": 60}
        for r in db.requests
    )


def test_release_stale_locks_list_dict_response():
    """RPC returns [{ "fn_release_stale_pipeline_locks": 7 }] → returns 7."""
    from modules import queue_health

    db = FakeDb()
    db.add_route(
        lambda m, u, p, j: m == "POST" and "fn_release_stale_pipeline_locks" in u,
        lambda: _make_response(
            200,
            json_body=[{"fn_release_stale_pipeline_locks": 7}],
        ),
    )

    assert queue_health.release_stale_locks(db) == 7


def test_release_stale_locks_returns_zero_on_error():
    """RPC throws / 500 → release_stale_locks returns 0 (logged, not raised)."""
    from modules import queue_health

    db = FakeDb()
    db.add_route(
        lambda m, u, p, j: m == "POST" and "fn_release_stale_pipeline_locks" in u,
        lambda: _make_response(500),
    )

    assert queue_health.release_stale_locks(db) == 0


def test_release_stale_locks_no_db_returns_zero():
    """db=None is a no-op."""
    from modules import queue_health
    assert queue_health.release_stale_locks(None) == 0


# ─── _count_with_filter / build_snapshot ─────────────────────────────


def test_build_snapshot_counts_all_statuses_per_kind():
    """For a single kind, count GET returns content-range with the
    desired N → snapshot[kind][status] == N for each tracked status."""
    from modules import queue_health

    db = FakeDb()

    # Route every "select=id, limit=1, type=eq.<kind>" GET → 12 rows.
    def is_count(method, url, params, json):
        return method == "GET" and url.endswith("/pipeline_jobs") \
            and params.get("limit") == "1"

    # Each call returns 12 (deterministic — same number whatever status).
    db.add_route(is_count, lambda: _make_response(
        200, json_body=[], content_range="0-0/12"
    ))

    snap = queue_health.build_snapshot(db, kinds=["clip.create"])
    assert "clip.create" in snap["kinds"]
    row = snap["kinds"]["clip.create"]
    for status in queue_health.TRACKED_STATUSES:
        assert row[status] == 12, f"{status} should be 12, got {row[status]}"
    # Totals sum across all 4 statuses
    assert snap["totals"]["pending"] == 12
    assert snap["totals"]["claimed"] == 12


def test_build_snapshot_oldest_pending_age_triggers_warning():
    """oldest_pending_age > THRESHOLD_PENDING_WARN_SEC must produce a
    'stale_pending' warning."""
    from modules import queue_health

    db = FakeDb()

    # Counts : zero for everything (we only care about ages).
    db.add_route(
        lambda m, u, p, j: m == "GET" and u.endswith("/pipeline_jobs")
                            and p.get("limit") == "1",
        lambda: _make_response(200, json_body=[], content_range="0-0/0"),
    )

    # Oldest-row probes : a created_at 2h ago for pending, no claimed row.
    very_old = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()

    def is_oldest_pending_probe(method, url, params, json):
        return method == "GET" and url.endswith("/pipeline_jobs") \
            and params.get("status") == "eq.pending" \
            and params.get("order") == "created_at.asc"

    db.routes.insert(0, (
        is_oldest_pending_probe,
        lambda: _make_response(200, json_body=[{"created_at": very_old}]),
    ))

    snap = queue_health.build_snapshot(db, kinds=["clip.create"])
    row = snap["kinds"]["clip.create"]
    # 2h = 7200s, threshold is 30min = 1800s — should breach.
    assert row["oldest_pending_age_s"] >= 7000
    assert any(
        w["kind"] == "clip.create" and w["type"] == "stale_pending"
        for w in snap["warnings"]
    )


def test_build_snapshot_oldest_claimed_triggers_stale_claim_warning():
    """oldest_claimed_age > 4 × DEFAULT_LEASE_SECONDS triggers stale_claim."""
    from modules import queue_health

    db = FakeDb()

    db.add_route(
        lambda m, u, p, j: m == "GET" and u.endswith("/pipeline_jobs")
                            and p.get("limit") == "1",
        lambda: _make_response(200, json_body=[], content_range="0-0/0"),
    )

    # Claimed_at 30 min ago > 4*300 = 1200s = 20 min.
    very_old = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()

    def is_oldest_claimed_probe(method, url, params, json):
        return method == "GET" and url.endswith("/pipeline_jobs") \
            and params.get("status") == "eq.claimed" \
            and params.get("order") == "claimed_at.asc"

    db.routes.insert(0, (
        is_oldest_claimed_probe,
        lambda: _make_response(200, json_body=[{"claimed_at": very_old}]),
    ))

    snap = queue_health.build_snapshot(db, kinds=["clip.create"])
    row = snap["kinds"]["clip.create"]
    threshold = (
        queue_health.DEFAULT_LEASE_SECONDS
        * queue_health.STALE_CLAIM_LEASE_MULTIPLIER
    )
    assert row["oldest_claimed_age_s"] > threshold
    assert any(
        w["kind"] == "clip.create" and w["type"] == "stale_claim"
        for w in snap["warnings"]
    )


def test_build_snapshot_no_warnings_when_fresh():
    """Fresh queue (no old rows) → empty warnings list."""
    from modules import queue_health

    db = FakeDb()
    # Default route → empty bodies, no rows, age=0 everywhere.
    db.add_route(
        lambda m, u, p, j: True,
        lambda: _make_response(200, json_body=[], content_range="0-0/0"),
    )

    snap = queue_health.build_snapshot(db, kinds=["clip.create", "clip.analyze"])
    assert snap["warnings"] == []
    for kind in ("clip.create", "clip.analyze"):
        assert snap["kinds"][kind]["oldest_pending_age_s"] == 0
        assert snap["kinds"][kind]["oldest_claimed_age_s"] == 0


# ─── _safe_discord_ping ──────────────────────────────────────────────


def test_safe_discord_ping_swallows_webhook_errors(monkeypatch):
    """If notify_error raises, _safe_discord_ping logs and returns None."""
    from modules import queue_health
    from services import discord_webhook

    async def boom(*a, **k):
        raise RuntimeError("webhook dead")

    monkeypatch.setattr(discord_webhook, "notify_error", boom)

    # Must not raise.
    asyncio.run(queue_health._safe_discord_ping("title", "msg"))


def test_safe_discord_ping_calls_notify_error_when_configured(monkeypatch):
    """When notify_error works, _safe_discord_ping forwards title + msg."""
    from modules import queue_health
    from services import discord_webhook

    captured: list[tuple] = []

    async def fake_notify(title, message):
        captured.append((title, message))

    monkeypatch.setattr(discord_webhook, "notify_error", fake_notify)

    asyncio.run(queue_health._safe_discord_ping("titlex", "msgy"))
    assert captured == [("titlex", "msgy")]


# ─── End-to-end run() ────────────────────────────────────────────────


def test_run_no_db_returns_zero_counters(monkeypatch, patch_observability):
    """run() with get_db()=None must NOT crash + return zero counters."""
    from modules import queue_health

    monkeypatch.setattr(queue_health, "get_db", lambda: None)

    # Discord must NOT be called.
    discord_calls: list = []
    async def boom(*a, **k):
        discord_calls.append(("called",))

    from services import discord_webhook
    monkeypatch.setattr(discord_webhook, "notify_error", boom)

    result = asyncio.run(queue_health.run())
    assert result["items_scanned"] == 0
    assert result["items_processed"] == 0
    assert discord_calls == []


def test_run_emits_discord_for_warnings_and_caps(monkeypatch, patch_observability):
    """When build_snapshot returns N warnings (N > MAX_PINGS=3), only
    MAX_PINGS Discord notifications are sent."""
    from modules import queue_health
    from services import discord_webhook

    fake_db = FakeDb()
    monkeypatch.setattr(queue_health, "get_db", lambda: fake_db)
    monkeypatch.setattr(queue_health, "release_stale_locks", lambda db, **kw: 5)

    # Synthesize 7 warnings.
    def fake_snapshot(db, kinds=None):
        return {
            "kinds": {f"k{i}": {} for i in range(7)},
            "totals": {s: 0 for s in queue_health.TRACKED_STATUSES},
            "warnings": [
                {"kind": f"k{i}", "type": "stale_pending",
                 "value_s": 9999, "threshold_s": 1800}
                for i in range(7)
            ],
        }

    monkeypatch.setattr(queue_health, "build_snapshot", fake_snapshot)

    discord_calls: list = []

    async def fake_notify(title, message):
        discord_calls.append((title, message))

    monkeypatch.setattr(discord_webhook, "notify_error", fake_notify)

    result = asyncio.run(queue_health.run())

    # Exactly 3 pings, not 7.
    assert len(discord_calls) == 3
    # The result reports items_failed == total warnings count (7).
    assert result["items_failed"] == 7
    assert result["released_stale"] == 5


def test_run_calls_release_stale_locks_first(monkeypatch, patch_observability):
    """release_stale_locks must be invoked at the start of every cycle,
    BEFORE build_snapshot — that way the snapshot reflects the post-
    release state."""
    from modules import queue_health
    from services import discord_webhook

    fake_db = FakeDb()
    monkeypatch.setattr(queue_health, "get_db", lambda: fake_db)

    call_order: list[str] = []

    def fake_release(db, **kw):
        call_order.append("release")
        return 9

    def fake_snapshot(db, kinds=None):
        call_order.append("snapshot")
        return {
            "kinds": {},
            "totals": {s: 0 for s in queue_health.TRACKED_STATUSES},
            "warnings": [],
        }

    monkeypatch.setattr(queue_health, "release_stale_locks", fake_release)
    monkeypatch.setattr(queue_health, "build_snapshot", fake_snapshot)
    monkeypatch.setattr(discord_webhook, "notify_error",
                        lambda *a, **k: asyncio.sleep(0))

    asyncio.run(queue_health.run())
    assert call_order == ["release", "snapshot"]


# ─── Manual main runner ──────────────────────────────────────────────

if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v", "-s"]))
