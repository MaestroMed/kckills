"""Tests for modules/og_refresher.py.

Strategy
--------
The daemon talks to Supabase via httpx (3 endpoints : kills missing-OG
scan, kills recently-updated scan, and per-kill ai_annotations check)
and to the queue via services.job_queue.enqueue. We monkey-patch the
three internal scan helpers (`_scan_missing_og`, `_scan_recently_updated`,
`_has_recent_annotation`) so no httpx call ever leaves the test process.

@run_logged is silenced via the same `_try_insert_run` /
`_try_update_run` patches used by the other backfill tests.

Coverage (4 tests)
------------------
1. Missing-OG branch enqueues every match
2. Description-rewrite proxy : recently-updated kills with a recent
   ai_annotations row are enqueued ; ones without are skipped
3. Cap : MAX_ENQUEUE_PER_CYCLE limits the per-cycle volume even when
   far more are eligible
4. Dedup : a kill that appears in BOTH branches is only enqueued once
"""

from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import MagicMock

import pytest

# Add worker root to sys.path before importing.
_WORKER_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _WORKER_ROOT)

# Stub env so config.py doesn't refuse to import.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")


@pytest.fixture
def patch_observability(monkeypatch):
    """Silence the @run_logged decorator's Supabase calls."""
    from services import observability

    monkeypatch.setattr(observability, "_try_insert_run", lambda module_name: None)
    monkeypatch.setattr(observability, "_try_update_run", lambda *a, **k: None)
    yield


@pytest.fixture
def patched_module(monkeypatch, patch_observability):
    """Wire monkey-patches on the daemon module + return a Bag."""
    from modules import og_refresher as mod

    enqueue_calls: list[dict] = []

    def fake_enqueue(job_type, entity_type, entity_id, payload,
                     priority, run_after, max_attempts):
        enqueue_calls.append({
            "job_type": job_type,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "payload": payload,
            "priority": priority,
            "max_attempts": max_attempts,
        })
        return f"job-{entity_id}"

    from services import job_queue
    monkeypatch.setattr(job_queue, "enqueue", fake_enqueue)
    monkeypatch.setattr(mod.job_queue, "enqueue", fake_enqueue)

    # Fake DB so get_db() doesn't hit the network.
    fake_db = MagicMock(name="fake_db", base="https://x", headers={})
    monkeypatch.setattr(mod, "get_db", lambda: fake_db)

    # Default scan helpers : empty results. Each test overrides what
    # it needs.
    monkeypatch.setattr(mod, "_scan_missing_og", lambda db: [])
    monkeypatch.setattr(mod, "_scan_recently_updated", lambda db: [])
    monkeypatch.setattr(
        mod, "_has_recent_annotation", lambda db, kid, ts: False,
    )

    class Bag:
        pass
    bag = Bag()
    bag.module = mod
    bag.enqueue_calls = enqueue_calls
    bag.monkeypatch = monkeypatch
    return bag


# ─── Tests ────────────────────────────────────────────────────────────


def test_missing_og_branch_enqueues_all(monkeypatch, patched_module):
    """Branch A : every published kill with NULL og_image_url gets a job."""
    mod = patched_module.module

    missing = [
        {"id": "k-001", "game_id": "g-1",
         "killer_champion": "Ahri", "victim_champion": "Zed",
         "ai_description": "Banger", "highlight_score": 9.0},
        {"id": "k-002", "game_id": "g-1",
         "killer_champion": "Yone", "victim_champion": "Yasuo",
         "ai_description": "Solid", "highlight_score": 7.0},
        {"id": "k-003", "game_id": "g-2",
         "killer_champion": "Lulu", "victim_champion": "Thresh",
         "ai_description": "Cute", "highlight_score": 5.5},
    ]
    monkeypatch.setattr(mod, "_scan_missing_og", lambda db: missing)

    enqueued = asyncio.run(mod.run())

    enqueued_ids = sorted(c["entity_id"] for c in patched_module.enqueue_calls)
    assert enqueued_ids == ["k-001", "k-002", "k-003"]
    assert enqueued == 3

    # Verify queue priority + payload shape on the first call.
    first = patched_module.enqueue_calls[0]
    assert first["job_type"] == "og.generate"
    assert first["entity_type"] == "kill"
    assert first["priority"] == 60
    assert first["max_attempts"] == 3
    assert first["payload"]["kill_id"] in ("k-001", "k-002", "k-003")
    print("  [OK] Branch A enqueues every NULL-og_image_url kill")


def test_description_rewrite_proxy_filters_correctly(monkeypatch, patched_module):
    """Branch B : recently-updated kills are kept ONLY if they have a
    recent ai_annotations row matching their `updated_at` window.
    """
    mod = patched_module.module

    recently_updated = [
        # Kill with recent annotation — KEEP
        {"id": "kr-001", "game_id": "g-10",
         "killer_champion": "Akali", "victim_champion": "Vex",
         "ai_description": "Refreshed text", "highlight_score": 8.0,
         "updated_at": "2026-04-24T10:00:00+00:00",
         "og_image_url": "https://r2/og/kr-001.png"},
        # Kill with NO recent annotation (e.g. just a rating bump) — SKIP
        {"id": "kr-002", "game_id": "g-10",
         "killer_champion": "Lee Sin", "victim_champion": "Diana",
         "ai_description": "Unchanged text", "highlight_score": 6.5,
         "updated_at": "2026-04-24T09:00:00+00:00",
         "og_image_url": "https://r2/og/kr-002.png"},
        # Another recent annotation — KEEP
        {"id": "kr-003", "game_id": "g-11",
         "killer_champion": "Karthus", "victim_champion": "Kayn",
         "ai_description": "Fresh", "highlight_score": 7.7,
         "updated_at": "2026-04-24T08:00:00+00:00",
         "og_image_url": "https://r2/og/kr-003.png"},
    ]
    monkeypatch.setattr(mod, "_scan_recently_updated",
                        lambda db: recently_updated)

    # Annotation lookup : only kr-001 and kr-003 have recent annotations.
    def fake_has_recent(db, kid, ts):
        return kid in ("kr-001", "kr-003")
    monkeypatch.setattr(mod, "_has_recent_annotation", fake_has_recent)

    enqueued = asyncio.run(mod.run())

    enqueued_ids = sorted(c["entity_id"] for c in patched_module.enqueue_calls)
    assert enqueued_ids == ["kr-001", "kr-003"], \
        f"Only annotated kills should be enqueued ; got {enqueued_ids}"
    assert enqueued == 2
    # kr-002 must NOT be enqueued — no recent annotation.
    assert "kr-002" not in enqueued_ids
    print("  [OK] description-rewrite proxy keeps only annotated kills")


def test_cap_enforced_at_max_per_cycle(monkeypatch, patched_module):
    """Cap : even with 100 candidates, we stop at MAX_ENQUEUE_PER_CYCLE."""
    mod = patched_module.module

    # 100 missing-OG kills.
    missing = [
        {"id": f"k-{i:03d}", "game_id": "g-1",
         "killer_champion": "Ahri", "victim_champion": "Zed",
         "ai_description": f"Kill {i}", "highlight_score": 5.0}
        for i in range(100)
    ]
    monkeypatch.setattr(mod, "_scan_missing_og", lambda db: missing)

    enqueued = asyncio.run(mod.run())

    # MAX_ENQUEUE_PER_CYCLE = 50 — we must stop there.
    assert enqueued == mod.MAX_ENQUEUE_PER_CYCLE
    assert len(patched_module.enqueue_calls) == mod.MAX_ENQUEUE_PER_CYCLE
    print(f"  [OK] cap enforced at MAX_ENQUEUE_PER_CYCLE="
          f"{mod.MAX_ENQUEUE_PER_CYCLE}")


def test_dedup_kill_in_both_branches(monkeypatch, patched_module):
    """A kill that appears in both branches must only be enqueued once.
    Branch A (missing OG) takes precedence in the iteration order, so
    a duplicate id from Branch B should be skipped at the dedup layer.

    Note : in production this can't happen (Branch B requires
    og_image_url IS NOT NULL while Branch A requires IS NULL), but the
    in-Python dedup must still hold up for safety.
    """
    mod = patched_module.module

    shared_kill = {"id": "k-shared", "game_id": "g-1",
                   "killer_champion": "Ahri", "victim_champion": "Zed",
                   "ai_description": "X", "highlight_score": 8.0,
                   "updated_at": "2026-04-24T10:00:00+00:00",
                   "og_image_url": None}

    monkeypatch.setattr(mod, "_scan_missing_og", lambda db: [shared_kill])
    monkeypatch.setattr(mod, "_scan_recently_updated", lambda db: [shared_kill])
    monkeypatch.setattr(mod, "_has_recent_annotation",
                        lambda db, kid, ts: True)

    enqueued = asyncio.run(mod.run())

    # The same kill must only be enqueued ONCE.
    assert enqueued == 1
    assert len(patched_module.enqueue_calls) == 1
    assert patched_module.enqueue_calls[0]["entity_id"] == "k-shared"
    print("  [OK] dedup keeps a kill in both branches single-enqueued")


# ─── Manual main() runner ────────────────────────────────────────────


def _run_all():
    print("=== og_refresher Tests ===")
    pytest.main([__file__, "-v", "-s"])


if __name__ == "__main__":
    _run_all()
