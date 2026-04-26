"""Tests for scripts/backfill_stuck_pipeline.py.

Strategy
--------
Same approach as test_backfill_clip_errors.py — monkey-patch the script's
view of `_fetch_page`, `_reset_status`, and `services.job_queue.enqueue`
so nothing leaves the test process. The @run_logged decorator's Supabase
writes are silenced by patching `_try_insert_run` / `_try_update_run`
inside services.observability.

Coverage
--------
* dry-run does no writes for any state
* --state mode (single-state) only touches that state's rows
* --all mode hits every state (manual_review / vod_found / clipped /
  analyzed) in one pass
* --min-score filters as expected
* manual_review skips qc_status='failed' and 'rejected' rows
* vod_found does NOT apply the qc filter (only manual_review does)
* enqueue() returning None still flips status (idempotent recovery)
* status reset target matches STATE_CONFIG (enriched for some, None
  for others — None means no PATCH at all)
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


# ─── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture
def patch_observability(monkeypatch):
    """Silence the @run_logged decorator's Supabase calls."""
    from services import observability

    monkeypatch.setattr(observability, "_try_insert_run", lambda module_name: None)
    monkeypatch.setattr(observability, "_try_update_run", lambda *a, **k: None)
    yield


@pytest.fixture
def fake_kills_by_state():
    """Per-state fixtures.

    Each kill carries a `qc_status` so the manual_review filter logic
    can be exercised. retry_count + highlight_score vary so the priority
    + score-filter paths are covered too.
    """
    return {
        "manual_review": [
            # qc-passed → eligible
            {"id": "mr-001", "game_id": "g-001", "killer_player_id": "p-1",
             "killer_champion": "Ahri", "victim_player_id": "p-2",
             "victim_champion": "Zed", "event_epoch": 1700000000,
             "highlight_score": 8.0, "retry_count": 1,
             "qc_status": "passed", "created_at": "2026-04-01T00:00:00Z"},
            # qc-failed → SKIP (the whole point of the qc filter)
            {"id": "mr-002", "game_id": "g-001", "killer_player_id": "p-3",
             "killer_champion": "LeBlanc", "victim_player_id": "p-4",
             "victim_champion": "Yasuo", "event_epoch": 1700000010,
             "highlight_score": 7.5, "retry_count": 0,
             "qc_status": "failed", "created_at": "2026-04-01T00:00:00Z"},
            # qc-rejected (forward-compat) → SKIP
            {"id": "mr-003", "game_id": "g-002", "killer_player_id": "p-5",
             "killer_champion": "Jinx", "victim_player_id": "p-6",
             "victim_champion": "Caitlyn", "event_epoch": 1700000020,
             "highlight_score": 6.0, "retry_count": 0,
             "qc_status": "rejected", "created_at": "2026-04-01T00:00:00Z"},
            # qc-pending → eligible
            {"id": "mr-004", "game_id": "g-002", "killer_player_id": "p-7",
             "killer_champion": "Sett", "victim_player_id": "p-8",
             "victim_champion": "Aatrox", "event_epoch": 1700000030,
             "highlight_score": 5.5, "retry_count": 0,
             "qc_status": "pending", "created_at": "2026-04-01T00:00:00Z"},
            # qc NULL → eligible (NULL is not in the killed-set)
            {"id": "mr-005", "game_id": "g-003", "killer_player_id": "p-9",
             "killer_champion": "Lulu", "victim_player_id": "p-10",
             "victim_champion": "Thresh", "event_epoch": 1700000040,
             "highlight_score": None, "retry_count": 0,
             "qc_status": None, "created_at": "2026-04-01T00:00:00Z"},
        ],
        "vod_found": [
            {"id": "vf-001", "game_id": "g-010", "killer_player_id": "p-11",
             "killer_champion": "Yone", "victim_player_id": "p-12",
             "victim_champion": "Lucian", "event_epoch": 1700001000,
             "highlight_score": 9.0, "retry_count": 1,
             # qc_status='failed' must still process — vod_found does NOT
             # apply the qc filter (only manual_review does).
             "qc_status": "failed", "created_at": "2026-04-01T00:00:00Z"},
            {"id": "vf-002", "game_id": "g-010", "killer_player_id": "p-13",
             "killer_champion": "Akali", "victim_player_id": "p-14",
             "victim_champion": "Vex", "event_epoch": 1700001010,
             "highlight_score": 4.0, "retry_count": 0,
             "qc_status": "pending", "created_at": "2026-04-01T00:00:00Z"},
        ],
        "clipped": [
            {"id": "cl-001", "game_id": "g-020", "killer_player_id": "p-21",
             "killer_champion": "Lee Sin", "victim_player_id": "p-22",
             "victim_champion": "Diana", "event_epoch": 1700002000,
             "highlight_score": 6.5, "retry_count": 2,
             "qc_status": "pending", "created_at": "2026-04-01T00:00:00Z"},
        ],
        "analyzed": [
            {"id": "an-001", "game_id": "g-030", "killer_player_id": "p-31",
             "killer_champion": "Senna", "victim_player_id": "p-32",
             "victim_champion": "Soraka", "event_epoch": 1700003000,
             "highlight_score": 7.8, "retry_count": 0,
             "qc_status": "passed", "created_at": "2026-04-01T00:00:00Z"},
            {"id": "an-002", "game_id": "g-030", "killer_player_id": "p-33",
             "killer_champion": "Karthus", "victim_player_id": "p-34",
             "victim_champion": "Kayn", "event_epoch": 1700003010,
             "highlight_score": 5.0, "retry_count": 0,
             "qc_status": "passed", "created_at": "2026-04-01T00:00:00Z"},
        ],
    }


@pytest.fixture
def patched_script(monkeypatch, fake_kills_by_state, patch_observability):
    """Wire monkey-patches on the script + return a Bag with assertions."""
    from scripts import backfill_stuck_pipeline as mod

    enqueue_calls: list[dict] = []
    reset_calls: list[dict] = []  # {kill_id, target_status}

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

    def fake_reset(db, kill_id, *, target_status):
        reset_calls.append({"kill_id": kill_id, "target_status": target_status})
        return True

    from services import job_queue
    monkeypatch.setattr(job_queue, "enqueue", fake_enqueue)
    monkeypatch.setattr(mod.job_queue, "enqueue", fake_enqueue)
    monkeypatch.setattr(mod, "_reset_status", fake_reset)

    fake_db = MagicMock(name="fake_db", base="https://x", headers={})
    monkeypatch.setattr(mod, "get_db", lambda: fake_db)

    def fake_fetch_page(db, *, state, offset, page_size, min_score, since_iso):
        # Mimic the SQL filters in-Python against the per-state fixture.
        rows = fake_kills_by_state.get(state, [])
        eligible = [
            k for k in rows
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
    bag.fake_kills_by_state = fake_kills_by_state
    return bag


# ─── Tests ────────────────────────────────────────────────────────────


def test_dry_run_does_no_writes(patched_script):
    """--dry-run on --state all : must not enqueue or reset."""
    mod = patched_script.module
    result = asyncio.run(mod._amain(
        state="all", dry_run=True, limit=None,
        min_score=0.0, since_days=90,
    ))

    assert patched_script.enqueue_calls == [], \
        f"dry_run still called enqueue : {patched_script.enqueue_calls}"
    assert patched_script.reset_calls == [], \
        f"dry_run still reset status : {patched_script.reset_calls}"

    # Should still report what it WOULD have done.
    # manual_review : 5 rows total, 2 skipped by qc → 3 eligible
    # vod_found : 2 rows
    # clipped : 1 row
    # analyzed : 2 rows
    # = 8 enqueues counted
    assert result["items_processed"] == 8
    assert result["items_scanned"] == 10  # all rows scanned (2 qc-skipped)
    print("  [OK] dry_run does no writes, but counts correctly across states")


def test_single_state_only_touches_that_state(patched_script):
    """--state vod_found should only enqueue clip.create on vf-* kills."""
    mod = patched_script.module
    asyncio.run(mod._amain(
        state="vod_found", dry_run=False, limit=None,
        min_score=0.0, since_days=90,
    ))

    enqueued_ids = [c["entity_id"] for c in patched_script.enqueue_calls]
    assert sorted(enqueued_ids) == ["vf-001", "vf-002"]
    # All vod_found enqueues use clip.create.
    assert all(c["job_type"] == "clip.create"
               for c in patched_script.enqueue_calls)
    # vod_found's reset_status is 'enriched'.
    assert all(r["target_status"] == "enriched"
               for r in patched_script.reset_calls)
    assert sorted(r["kill_id"] for r in patched_script.reset_calls) == \
        ["vf-001", "vf-002"]
    print("  [OK] single --state vod_found only touches vf-* kills")


def test_all_mode_dispatches_each_state_to_correct_job_type(patched_script):
    """--state all : each state hits its mapped job type exactly."""
    mod = patched_script.module
    asyncio.run(mod._amain(
        state="all", dry_run=False, limit=None,
        min_score=0.0, since_days=90,
    ))

    # Count by (state-prefix, job_type). Use the kill_id prefix to know
    # which state it came from.
    by_prefix_job: dict[tuple[str, str], int] = {}
    for c in patched_script.enqueue_calls:
        prefix = c["entity_id"].split("-", 1)[0]
        by_prefix_job[(prefix, c["job_type"])] = \
            by_prefix_job.get((prefix, c["job_type"]), 0) + 1

    # manual_review (3 eligible after qc filter) -> clip.create
    assert by_prefix_job.get(("mr", "clip.create")) == 3
    # vod_found (2) -> clip.create
    assert by_prefix_job.get(("vf", "clip.create")) == 2
    # clipped (1) -> clip.analyze
    assert by_prefix_job.get(("cl", "clip.analyze")) == 1
    # analyzed (2) -> publish.check
    assert by_prefix_job.get(("an", "publish.check")) == 2

    # Total enqueues = 8.
    assert len(patched_script.enqueue_calls) == 8
    print("  [OK] --state all dispatches each state to its mapped job type")


def test_manual_review_skips_qc_killed(patched_script):
    """qc_status in {failed, rejected} → skip ; pending/passed/None → enqueue."""
    mod = patched_script.module
    asyncio.run(mod._amain(
        state="manual_review", dry_run=False, limit=None,
        min_score=0.0, since_days=90,
    ))

    enqueued_ids = [c["entity_id"] for c in patched_script.enqueue_calls]
    # mr-001 (passed), mr-004 (pending), mr-005 (None) → enqueued.
    assert "mr-001" in enqueued_ids
    assert "mr-004" in enqueued_ids
    assert "mr-005" in enqueued_ids
    # mr-002 (failed), mr-003 (rejected) → SKIPPED.
    assert "mr-002" not in enqueued_ids, \
        "qc_status='failed' must be skipped on manual_review"
    assert "mr-003" not in enqueued_ids, \
        "qc_status='rejected' must be skipped on manual_review"
    assert len(enqueued_ids) == 3

    # Manual_review uses default_priority=30 (NOT score-based).
    for c in patched_script.enqueue_calls:
        assert c["priority"] == 30, \
            f"manual_review priority should be 30 (got {c['priority']})"
    print("  [OK] manual_review skips qc_status in {failed, rejected}")


def test_vod_found_does_not_apply_qc_filter(patched_script):
    """vod_found must process even qc_status='failed' rows.

    Only manual_review applies the qc filter — for vod_found the row
    hasn't been QCed in a way that's relevant yet (no clip exists).
    """
    mod = patched_script.module
    asyncio.run(mod._amain(
        state="vod_found", dry_run=False, limit=None,
        min_score=0.0, since_days=90,
    ))

    enqueued_ids = [c["entity_id"] for c in patched_script.enqueue_calls]
    # vf-001 has qc_status='failed' but is vod_found → MUST be enqueued.
    assert "vf-001" in enqueued_ids, \
        "vod_found must NOT apply qc filter (only manual_review does)"
    print("  [OK] vod_found ignores qc_status filter (only mr applies it)")


def test_min_score_filter(patched_script):
    """--min-score 7.0 on --state analyzed : an-001 (7.8) yes, an-002 (5.0) no."""
    mod = patched_script.module
    asyncio.run(mod._amain(
        state="analyzed", dry_run=False, limit=None,
        min_score=7.0, since_days=90,
    ))

    enqueued_ids = [c["entity_id"] for c in patched_script.enqueue_calls]
    assert enqueued_ids == ["an-001"], \
        f"only an-001 (7.8) should pass min_score=7.0 ; got {enqueued_ids}"
    print("  [OK] --min-score filters as expected")


def test_priority_score_based_for_vod_found(patched_script):
    """vod_found uses score-based priority : floor(score * 10)."""
    mod = patched_script.module
    asyncio.run(mod._amain(
        state="vod_found", dry_run=False, limit=None,
        min_score=0.0, since_days=90,
    ))

    by_id = {c["entity_id"]: c["priority"]
             for c in patched_script.enqueue_calls}
    # vf-001 has score 9.0 → floor(90)=90.
    assert by_id["vf-001"] == 90
    # vf-002 has score 4.0 → 40.
    assert by_id["vf-002"] == 40
    print("  [OK] vod_found uses score-based priority (floor*10)")


def test_clipped_state_does_not_reset_status(patched_script):
    """clipped state has reset_status=None → no PATCH to kills.status."""
    mod = patched_script.module
    asyncio.run(mod._amain(
        state="clipped", dry_run=False, limit=None,
        min_score=0.0, since_days=90,
    ))

    # _reset_status IS called (so the no-op path is exercised), but
    # always with target_status=None — meaning the helper short-circuits.
    assert patched_script.reset_calls == [
        {"kill_id": "cl-001", "target_status": None},
    ]
    print("  [OK] clipped state passes target_status=None to reset helper")


def test_enqueue_returning_none_still_resets(monkeypatch, patched_script):
    """If enqueue returns None (already-enqueued), reset still fires."""
    mod = patched_script.module
    patched_script.enqueue_calls.clear()
    patched_script.reset_calls.clear()

    def enqueue_none(*a, **k):
        return None
    monkeypatch.setattr(mod.job_queue, "enqueue", enqueue_none)

    asyncio.run(mod._amain(
        state="vod_found", dry_run=False, limit=None,
        min_score=0.0, since_days=90,
    ))

    # vod_found has 2 rows ; both should still hit reset even though
    # enqueue returned None.
    reset_ids = sorted(r["kill_id"] for r in patched_script.reset_calls)
    assert reset_ids == ["vf-001", "vf-002"]
    print("  [OK] None-from-enqueue still triggers status reset")


def test_priority_helper():
    """_priority_from_score : floor(score*10), default for None."""
    from scripts import backfill_stuck_pipeline as mod
    assert mod._priority_from_score(9.5) == 95
    assert mod._priority_from_score(7.0) == 70
    assert mod._priority_from_score(0.1) == 1
    assert mod._priority_from_score(None) == 50  # default 50 used
    assert mod._priority_from_score(None, default=30) == 30
    print("  [OK] priority helper math correct")


def test_unknown_state_returns_failure(patched_script):
    """Bogus --state value : refuses with items_failed=1, no writes."""
    mod = patched_script.module
    result = asyncio.run(mod._amain(
        state="bogus", dry_run=False, limit=None,
        min_score=0.0, since_days=90,
    ))
    assert result["items_failed"] == 1
    assert patched_script.enqueue_calls == []
    print("  [OK] unknown state refuses cleanly")


def test_limit_caps_processing_per_state(patched_script):
    """--limit 1 with --state all : each state stops at 1 row."""
    mod = patched_script.module
    asyncio.run(mod._amain(
        state="all", dry_run=False, limit=1,
        min_score=0.0, since_days=90,
    ))
    # 4 states * 1 row each = 4 enqueues max.
    assert len(patched_script.enqueue_calls) <= 4
    # Each state should have at most 1 enqueue.
    by_prefix: dict[str, int] = {}
    for c in patched_script.enqueue_calls:
        p = c["entity_id"].split("-", 1)[0]
        by_prefix[p] = by_prefix.get(p, 0) + 1
    for p, n in by_prefix.items():
        assert n == 1, f"prefix {p} got {n} enqueues, expected 1"
    print("  [OK] --limit applies per-state on --state all")


# ─── Manual main runner ────────────────────────────────────────────


def _run_all():
    print("=== backfill_stuck_pipeline Tests ===")
    pytest.main([__file__, "-v", "-s"])


if __name__ == "__main__":
    _run_all()
