"""Tests for scripts/backfill_og_images.py.

Strategy
--------
Mirror the test_backfill_clip_errors.py pattern : monkey-patch the
script's view of `_fetch_page` and `services.job_queue.enqueue` so
nothing leaves the test process. The @run_logged decorator's Supabase
writes are silenced via patches on `_try_insert_run` / `_try_update_run`.

Coverage (6 tests)
------------------
1. dry-run does no enqueue calls
2. enqueue happens for every published kill missing og_image_url
3. dedup : enqueue returning None is accounted as 'skipped' (not error)
4. --limit caps the total enqueues
5. --min-score filters the candidate set
6. --force re-enqueues even when og_image_url is already set
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
def fake_kills():
    """Six published kills with mixed og_image_url state and varied
    highlight_score so the filter / force / limit branches are all
    exercisable."""
    return [
        # Missing OG, high score
        {"id": "k-001", "game_id": "g-001",
         "killer_champion": "Ahri", "victim_champion": "Zed",
         "ai_description": "Banger outplay", "highlight_score": 9.5,
         "og_image_url": None},
        # Missing OG, mid score
        {"id": "k-002", "game_id": "g-001",
         "killer_champion": "LeBlanc", "victim_champion": "Yasuo",
         "ai_description": "Solid pickoff", "highlight_score": 7.2,
         "og_image_url": None},
        # Missing OG, low score
        {"id": "k-003", "game_id": "g-002",
         "killer_champion": "Jinx", "victim_champion": "Caitlyn",
         "ai_description": "Routine kill", "highlight_score": 3.5,
         "og_image_url": None},
        # Missing OG, NULL score
        {"id": "k-004", "game_id": "g-002",
         "killer_champion": "Sett", "victim_champion": "Aatrox",
         "ai_description": "No-AI kill", "highlight_score": None,
         "og_image_url": None},
        # HAS OG, high score (force-only target)
        {"id": "k-005", "game_id": "g-003",
         "killer_champion": "Lulu", "victim_champion": "Thresh",
         "ai_description": "Already-OG kill", "highlight_score": 8.1,
         "og_image_url": "https://r2/og/k-005.png"},
        # HAS OG, low score (force-only target, score-filtered)
        {"id": "k-006", "game_id": "g-003",
         "killer_champion": "Veigar", "victim_champion": "Lux",
         "ai_description": "Cute combo", "highlight_score": 2.0,
         "og_image_url": "https://r2/og/k-006.png"},
    ]


@pytest.fixture
def patched_script(monkeypatch, fake_kills, patch_observability):
    """Wire monkey-patches and return a Bag with assertion handles."""
    from scripts import backfill_og_images as mod

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

    fake_db = MagicMock(name="fake_db", base="https://x", headers={})
    monkeypatch.setattr(mod, "get_db", lambda: fake_db)

    def fake_fetch_page(db, *, offset, page_size, min_score, force):
        # Mimic the SQL filter chain in-Python.
        rows = list(fake_kills)
        if not force:
            rows = [k for k in rows if k.get("og_image_url") is None]
        if min_score > 0:
            rows = [
                k for k in rows
                if (k.get("highlight_score") or 0.0) >= min_score
            ]
        return rows[offset:offset + page_size]

    monkeypatch.setattr(mod, "_fetch_page", fake_fetch_page)

    class Bag:
        pass
    bag = Bag()
    bag.module = mod
    bag.enqueue_calls = enqueue_calls
    bag.fake_kills = fake_kills
    return bag


# ─── Tests ────────────────────────────────────────────────────────────


def test_dry_run_does_no_writes(patched_script):
    """--dry-run should NOT call enqueue, but still count what it would do."""
    mod = patched_script.module
    result = asyncio.run(mod._amain(
        dry_run=True, limit=None, min_score=0.0, force=False,
    ))

    assert patched_script.enqueue_calls == [], \
        f"dry_run still called enqueue : {patched_script.enqueue_calls}"
    # 4 kills missing OG (k-001..k-004) — all should be counted as
    # would-be-processed.
    assert result["items_scanned"] == 4
    assert result["items_processed"] == 4
    assert result["dry_run"] is True
    assert result["force"] is False
    print("  [OK] dry_run does no writes, but counts correctly")


def test_full_flow_enqueues_missing_og(patched_script):
    """Default run : every published kill without og_image_url gets a job."""
    mod = patched_script.module
    result = asyncio.run(mod._amain(
        dry_run=False, limit=None, min_score=0.0, force=False,
    ))

    enqueued_ids = sorted(c["entity_id"] for c in patched_script.enqueue_calls)
    # k-001..k-004 are all missing og_image_url ; k-005, k-006 have OGs.
    assert enqueued_ids == ["k-001", "k-002", "k-003", "k-004"]

    # Verify shape on the high-score row.
    k001_call = next(c for c in patched_script.enqueue_calls
                     if c["entity_id"] == "k-001")
    assert k001_call["job_type"] == "og.generate"
    assert k001_call["entity_type"] == "kill"
    assert k001_call["payload"] == {"kill_id": "k-001", "game_id": "g-001"}
    # Priority = QUEUE_PRIORITY = 60 (above default 50, below editorial 80).
    assert k001_call["priority"] == 60
    assert k001_call["max_attempts"] == 3

    assert result["items_processed"] == 4
    assert result["items_failed"] == 0
    print("  [OK] full flow enqueues every missing-OG kill at priority 60")


def test_dedup_via_enqueue_returning_none(monkeypatch, patched_script):
    """If job_queue.enqueue returns None (already-enqueued via the unique
    partial index), we count it as `skipped`, NOT as an error.
    """
    mod = patched_script.module
    patched_script.enqueue_calls.clear()

    def enqueue_none(*a, **k):
        # Still record so we know it was called.
        patched_script.enqueue_calls.append({"called": True})
        return None

    monkeypatch.setattr(mod.job_queue, "enqueue", enqueue_none)

    result = asyncio.run(mod._amain(
        dry_run=False, limit=None, min_score=0.0, force=False,
    ))
    # 4 kills scanned, 4 enqueue attempts, all returned None → all skipped.
    assert len(patched_script.enqueue_calls) == 4
    assert result["items_processed"] == 0
    assert result["items_skipped"] == 4
    assert result["items_failed"] == 0
    print("  [OK] None-from-enqueue counts as skipped, not error")


def test_limit_caps_total_enqueues(patched_script):
    """--limit 2 stops after the first 2 rows even though 4 are eligible."""
    mod = patched_script.module
    result = asyncio.run(mod._amain(
        dry_run=False, limit=2, min_score=0.0, force=False,
    ))

    assert len(patched_script.enqueue_calls) == 2
    assert result["items_processed"] == 2
    # Order is highlight_score.desc.nullslast,created_at.desc — so we
    # expect k-001 (9.5) and k-002 (7.2) to come first.
    enqueued_ids = [c["entity_id"] for c in patched_script.enqueue_calls]
    assert "k-001" in enqueued_ids
    assert "k-002" in enqueued_ids
    print("  [OK] --limit caps total enqueues")


def test_min_score_filter(patched_script):
    """--min-score 7.0 keeps only k-001 (9.5) and k-002 (7.2)."""
    mod = patched_script.module
    asyncio.run(mod._amain(
        dry_run=False, limit=None, min_score=7.0, force=False,
    ))

    enqueued_ids = sorted(c["entity_id"] for c in patched_script.enqueue_calls)
    assert enqueued_ids == ["k-001", "k-002"], \
        f"min_score=7.0 should keep only k-001 and k-002 ; got {enqueued_ids}"
    print("  [OK] --min-score filters as expected")


def test_force_reenqueues_even_when_og_present(patched_script):
    """--force should include k-005 and k-006 too (they have OGs)."""
    mod = patched_script.module
    asyncio.run(mod._amain(
        dry_run=False, limit=None, min_score=0.0, force=True,
    ))

    enqueued_ids = sorted(c["entity_id"] for c in patched_script.enqueue_calls)
    # All 6 kills should be enqueued, including those with og_image_url set.
    assert enqueued_ids == [
        "k-001", "k-002", "k-003", "k-004", "k-005", "k-006",
    ]
    print("  [OK] --force re-enqueues every published kill")


# ─── Manual main() runner ────────────────────────────────────────────


def _run_all():
    print("=== backfill_og_images Tests ===")
    pytest.main([__file__, "-v", "-s"])


if __name__ == "__main__":
    _run_all()
