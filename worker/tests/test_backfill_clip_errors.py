"""Tests for scripts/backfill_clip_errors.py.

Strategy
--------
The script talks to Supabase via httpx (paginated SELECT + per-row PATCH)
and to the job queue via services.job_queue.enqueue. We monkey-patch :

  * scripts.backfill_clip_errors._fetch_page  → returns a fixed list
  * scripts.backfill_clip_errors._reset_status → records calls
  * services.job_queue.enqueue                → records calls + returns
                                                a fake UUID

That keeps the tests pure-Python : no httpx wire calls, no Supabase env,
no asyncio.to_thread surprises (asyncio.to_thread on a non-blocking
function is fine in a test loop).

We also bypass the @run_logged decorator's Supabase write by patching
its inner helpers — the wrapper itself swallows failures, so technically
we don't HAVE to, but skipping the noise makes test output cleaner.
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
    monkeypatch.setattr(
        observability,
        "_try_update_run",
        lambda *a, **k: None,
    )
    yield


@pytest.fixture
def fake_kills():
    """Five clip_error kills with varying highlight_score."""
    return [
        {"id": "k-001", "game_id": "g-001", "killer_player_id": "p-1",
         "killer_champion": "Ahri", "victim_player_id": "p-2",
         "victim_champion": "Zed", "event_epoch": 1700000000,
         "highlight_score": 9.5, "retry_count": 1},
        {"id": "k-002", "game_id": "g-001", "killer_player_id": "p-3",
         "killer_champion": "LeBlanc", "victim_player_id": "p-4",
         "victim_champion": "Yasuo", "event_epoch": 1700000010,
         "highlight_score": 7.2, "retry_count": 0},
        {"id": "k-003", "game_id": "g-002", "killer_player_id": "p-5",
         "killer_champion": "Jinx", "victim_player_id": "p-6",
         "victim_champion": "Caitlyn", "event_epoch": 1700000020,
         "highlight_score": 5.0, "retry_count": 2},
        {"id": "k-004", "game_id": "g-002", "killer_player_id": "p-7",
         "killer_champion": "Sett", "victim_player_id": "p-8",
         "victim_champion": "Aatrox", "event_epoch": 1700000030,
         "highlight_score": 3.1, "retry_count": 0},
        {"id": "k-005", "game_id": "g-003", "killer_player_id": "p-9",
         "killer_champion": "Lulu", "victim_player_id": "p-10",
         "victim_champion": "Thresh", "event_epoch": 1700000040,
         "highlight_score": None, "retry_count": 0},
    ]


@pytest.fixture
def patched_script(monkeypatch, fake_kills, patch_observability):
    """Import the script + wire up monkey-patches.

    Returns a struct with :
        .module      : the imported script module
        .enqueue_calls : list[dict] — args of every job_queue.enqueue call
        .reset_calls   : list[str]  — kill_ids that got status reset
    """
    from scripts import backfill_clip_errors as mod

    enqueue_calls: list[dict] = []
    reset_calls: list[str] = []

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

    def fake_reset(db, kill_id):
        reset_calls.append(kill_id)
        return True

    # Patch the script's view of those names — we mock at the boundary the
    # script imported them at, not at the source module, so the script's
    # internal `await asyncio.to_thread(job_queue.enqueue, ...)` resolves
    # to our fake.
    from services import job_queue
    monkeypatch.setattr(job_queue, "enqueue", fake_enqueue)
    monkeypatch.setattr(mod.job_queue, "enqueue", fake_enqueue)
    monkeypatch.setattr(mod, "_reset_status", fake_reset)

    # Fake DB so get_db() doesn't hit the network.
    fake_db = MagicMock(name="fake_db", base="https://x", headers={})
    monkeypatch.setattr(mod, "get_db", lambda: fake_db)

    # Fake _fetch_page that filters fake_kills by min_score and pages it.
    def fake_fetch_page(db, *, offset, page_size, min_score):
        # Apply the same filters the SQL would
        eligible = [
            k for k in fake_kills
            if int(k.get("retry_count") or 0) < mod.MAX_RETRIES
            and (k.get("highlight_score") or 0.0) >= min_score
        ]
        return eligible[offset:offset + page_size]

    monkeypatch.setattr(mod, "_fetch_page", fake_fetch_page)

    class Bag:
        pass
    bag = Bag()
    bag.module = mod
    bag.enqueue_calls = enqueue_calls
    bag.reset_calls = reset_calls
    bag.fake_kills = fake_kills
    return bag


# ─── Tests ────────────────────────────────────────────────────────────


def test_dry_run_does_no_writes(patched_script):
    """--dry-run mode must not call enqueue or reset."""
    mod = patched_script.module
    result = asyncio.run(mod._amain(dry_run=True, limit=None, min_score=0.0))

    assert patched_script.enqueue_calls == [], \
        f"dry_run still called enqueue : {patched_script.enqueue_calls}"
    assert patched_script.reset_calls == [], \
        f"dry_run still reset status : {patched_script.reset_calls}"

    # Should still report what it WOULD have done.
    # All 5 fixtures have retry_count<3 → all eligible.
    assert result["items_scanned"] == 5
    assert result["items_processed"] == 5
    print("  [OK] dry_run does no writes, but counts correctly")


def test_min_score_filter_excludes_low_score(patched_script):
    """--min-score 7.0 should only include k-001 (9.5) and k-002 (7.2)."""
    mod = patched_script.module
    asyncio.run(mod._amain(dry_run=False, limit=None, min_score=7.0))

    enqueued_ids = [c["entity_id"] for c in patched_script.enqueue_calls]
    assert "k-001" in enqueued_ids, "k-001 (9.5) should be enqueued"
    assert "k-002" in enqueued_ids, "k-002 (7.2) should be enqueued"
    assert "k-003" not in enqueued_ids, "k-003 (5.0) is below 7.0, must skip"
    assert "k-004" not in enqueued_ids, "k-004 (3.1) is below 7.0, must skip"
    assert "k-005" not in enqueued_ids, "k-005 (None) is below 7.0, must skip"
    assert len(patched_script.enqueue_calls) == 2

    # Status reset should mirror the enqueues.
    assert sorted(patched_script.reset_calls) == ["k-001", "k-002"]
    print("  [OK] min_score filter excludes low-score rows")


def test_successful_flow_enqueues_and_resets(patched_script):
    """Default run : every eligible kill gets a job + status reset."""
    mod = patched_script.module
    result = asyncio.run(mod._amain(dry_run=False, limit=None, min_score=0.0))

    # 4 eligible (k-001..k-004 has retry_count<3 ; k-005 has retry_count=0)
    # All 5 are eligible by retry_count, so all 5 get processed.
    assert len(patched_script.enqueue_calls) == 5
    assert sorted(patched_script.reset_calls) == [
        "k-001", "k-002", "k-003", "k-004", "k-005",
    ]

    # Verify payload shape on the highest-score call.
    k001_call = next(c for c in patched_script.enqueue_calls
                     if c["entity_id"] == "k-001")
    assert k001_call["job_type"] == "clip.create"
    assert k001_call["entity_type"] == "kill"
    assert k001_call["payload"] == {"kill_id": "k-001", "game_id": "g-001"}
    # Priority = floor(9.5 * 10) = 95
    assert k001_call["priority"] == 95

    # k-005 has highlight_score=None → default 5.0 → priority 50.
    k005_call = next(c for c in patched_script.enqueue_calls
                     if c["entity_id"] == "k-005")
    assert k005_call["priority"] == 50, \
        f"None score should default to priority 50, got {k005_call['priority']}"

    assert result["items_processed"] == 5
    assert result["items_failed"] == 0
    print("  [OK] full flow enqueues + resets every eligible kill")


def test_priority_calculation_helper(patched_script):
    """Standalone : _priority_from_score(score) = floor(score * 10)."""
    mod = patched_script.module
    assert mod._priority_from_score(9.5) == 95
    assert mod._priority_from_score(7.2) == 72
    assert mod._priority_from_score(5.0) == 50
    assert mod._priority_from_score(0.1) == 1
    assert mod._priority_from_score(None) == 50  # default 5.0 → 50
    assert mod._priority_from_score(10.0) == 100
    print("  [OK] priority calc matches floor(score*10)")


def test_limit_caps_processing(patched_script):
    """--limit 2 should stop after the first 2 rows even if more match."""
    mod = patched_script.module
    asyncio.run(mod._amain(dry_run=False, limit=2, min_score=0.0))
    assert len(patched_script.enqueue_calls) == 2
    assert len(patched_script.reset_calls) == 2
    print("  [OK] limit caps processing at N rows")


def test_enqueue_returning_none_still_resets(monkeypatch, patched_script):
    """If enqueue returns None (already-enqueued), we must STILL reset
    so the legacy job_dispatcher stops re-bridging the row.
    """
    mod = patched_script.module
    patched_script.enqueue_calls.clear()
    patched_script.reset_calls.clear()

    def enqueue_none(*a, **k):
        return None

    monkeypatch.setattr(mod.job_queue, "enqueue", enqueue_none)

    asyncio.run(mod._amain(dry_run=False, limit=2, min_score=0.0))
    # 2 rows scanned, 0 actually enqueued, but BOTH should still reset.
    assert len(patched_script.reset_calls) == 2
    print("  [OK] None-from-enqueue still triggers status reset")


# ─── Manual main() runner — for `python tests/test_backfill_clip_errors.py` ─

def _run_all():
    print("=== backfill_clip_errors Tests ===")
    pytest.main([__file__, "-v", "-s"])


if __name__ == "__main__":
    _run_all()
