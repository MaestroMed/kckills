"""Tests for modules/job_dispatcher.py (Wave 1).

Coverage
--------
job_dispatcher bridges legacy kills.status → pipeline_jobs queue. It
scans for kills in transitional statuses (vod_found, clipped, analyzed)
and enqueues the right next-step job for each. Idempotency is provided
by the unique partial index in pipeline_jobs.

We cover:
  * vod_found scan → clip.create enqueued for each
  * clipped scan → clip.analyze enqueued for each
  * analyzed scan → og.generate + embedding.compute + event.map (3 jobs
    per kill, by design — the analyzer pre-queue model didn't enqueue
    them either)
  * publishable game_events → publish.check enqueued for each
  * enqueue() returning None (dedup) is treated as "not-counted but
    not-an-error"
  * cycle reporting: total_enqueued reflects sum of all transitions
  * empty scans → 0,0 returned (no enqueues, no calls beyond the scan)

Strategy
--------
We patch:
  * modules.job_dispatcher._scan_status      (returns canned rows)
  * modules.job_dispatcher.httpx.get          (publishable scan path)
  * services.job_queue.enqueue                (records calls + returns
                                              fake UUID or None)

NO Supabase calls leave the test process.
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


# ─── Shared fixtures ─────────────────────────────────────────────────


@pytest.fixture
def patch_observability(monkeypatch):
    """Silence the @run_logged decorator's Supabase calls."""
    from services import observability

    monkeypatch.setattr(observability, "_try_insert_run", lambda module_name: None)
    monkeypatch.setattr(observability, "_try_update_run", lambda *a, **k: None)
    yield


@pytest.fixture
def patched_dispatcher(monkeypatch, patch_observability):
    """Patch _scan_status, the publishable httpx GET, and job_queue.enqueue.

    Returns a struct exposing the captured enqueue calls + a setter for
    the per-status fake-row maps.
    """
    from modules import job_dispatcher as mod
    from services import job_queue

    enqueue_calls: list[dict] = []
    rows_by_status: dict[str, list[dict]] = {}
    publishable_rows: list[dict] = []

    def fake_enqueue(
        job_type, entity_type, entity_id,
        payload=None, priority=50, run_after=None, max_attempts=3,
    ):
        enqueue_calls.append({
            "job_type": job_type,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "priority": priority,
        })
        return f"fake-job-{entity_id}-{job_type}"

    def fake_scan_status(status, columns="id"):
        return rows_by_status.get(status, [])

    # Mock the httpx.get used in _bridge_publishable_to_job
    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json = lambda: publishable_rows

    fake_db = MagicMock(name="fake_db")
    fake_db.base = "https://example.supabase.co/rest/v1"
    fake_db.headers = {}

    monkeypatch.setattr(mod, "_scan_status", fake_scan_status)
    monkeypatch.setattr(mod, "get_db", lambda: fake_db)
    monkeypatch.setattr(mod.httpx, "get", lambda *a, **k: fake_response)
    monkeypatch.setattr(job_queue, "enqueue", fake_enqueue)

    class Bag:
        pass
    bag = Bag()
    bag.module = mod
    bag.enqueue_calls = enqueue_calls
    bag.rows_by_status = rows_by_status
    bag.publishable_rows = publishable_rows
    return bag


# ─── Mapping tests ───────────────────────────────────────────────────


def test_vod_found_enqueues_clip_create(patched_dispatcher):
    """Each kill with status='vod_found' should get a clip.create job."""
    patched_dispatcher.rows_by_status["vod_found"] = [
        {"id": "kill-A"},
        {"id": "kill-B"},
    ]

    result = asyncio.run(patched_dispatcher.module.run())

    create_calls = [c for c in patched_dispatcher.enqueue_calls
                    if c["job_type"] == "clip.create"]
    assert len(create_calls) == 2
    assert {c["entity_id"] for c in create_calls} == {"kill-A", "kill-B"}
    # All entity_type=kill
    assert all(c["entity_type"] == "kill" for c in create_calls)
    # Priority=50 per the bridge call
    assert all(c["priority"] == 50 for c in create_calls)


def test_clipped_enqueues_clip_analyze(patched_dispatcher):
    """Each kill with status='clipped' should get a clip.analyze job."""
    patched_dispatcher.rows_by_status["clipped"] = [
        {"id": "kill-X"},
        {"id": "kill-Y"},
        {"id": "kill-Z"},
    ]

    asyncio.run(patched_dispatcher.module.run())

    analyze_calls = [c for c in patched_dispatcher.enqueue_calls
                     if c["job_type"] == "clip.analyze"]
    assert len(analyze_calls) == 3
    assert {c["entity_id"] for c in analyze_calls} == {"kill-X", "kill-Y", "kill-Z"}


def test_analyzed_enqueues_og_embedding_event_map_each(patched_dispatcher):
    """Each kill with status='analyzed' must get THREE jobs:
      og.generate + embedding.compute + event.map."""
    patched_dispatcher.rows_by_status["analyzed"] = [
        {"id": "kill-1"},
    ]

    asyncio.run(patched_dispatcher.module.run())

    types = sorted(c["job_type"] for c in patched_dispatcher.enqueue_calls)
    assert types == sorted(["og.generate", "embedding.compute", "event.map"])


def test_publishable_event_enqueues_publish_check(patched_dispatcher):
    """game_events with is_publishable=true should get publish.check jobs."""
    patched_dispatcher.publishable_rows.extend([
        {"id": "ev-1", "kill_id": "kill-evt-1"},
        {"id": "ev-2", "kill_id": "kill-evt-2"},
    ])

    asyncio.run(patched_dispatcher.module.run())

    publish_calls = [c for c in patched_dispatcher.enqueue_calls
                     if c["job_type"] == "publish.check"]
    assert len(publish_calls) == 2
    assert {c["entity_id"] for c in publish_calls} == {"ev-1", "ev-2"}
    assert all(c["entity_type"] == "event" for c in publish_calls)


# ─── Idempotency / dedup ─────────────────────────────────────────────


def test_enqueue_returning_none_means_dedup_no_count(monkeypatch, patched_dispatcher):
    """When job_queue.enqueue returns None (unique-index dedup), the
    dispatcher must NOT count it in the enqueued total — but also must
    NOT raise. The (type, entity_type, entity_id) unique partial index
    means re-runs are safe."""
    from services import job_queue

    patched_dispatcher.rows_by_status["vod_found"] = [
        {"id": "kill-dup-1"},
        {"id": "kill-dup-2"},
    ]

    # Replace fake_enqueue with one that always returns None.
    none_calls: list[dict] = []

    def enqueue_returns_none(
        job_type, entity_type, entity_id,
        payload=None, priority=50, run_after=None, max_attempts=3,
    ):
        none_calls.append({
            "job_type": job_type, "entity_id": entity_id,
        })
        return None

    monkeypatch.setattr(job_queue, "enqueue", enqueue_returns_none)

    # Re-runs are safe — no exceptions, just zero counted.
    result = asyncio.run(patched_dispatcher.module.run())

    # All 2 vod_found rows still get the enqueue ATTEMPT
    create_attempts = [c for c in none_calls if c["job_type"] == "clip.create"]
    assert len(create_attempts) == 2
    # But total returned is 0 (or only counts non-None returns).
    assert result == 0, f"dedup hits should not count, got total={result}"


# ─── Empty scans ─────────────────────────────────────────────────────


def test_empty_scans_returns_zero(patched_dispatcher):
    """No rows in any status → returns 0, no enqueue calls."""
    # rows_by_status default {} for all statuses
    # publishable_rows default []
    result = asyncio.run(patched_dispatcher.module.run())
    assert result == 0
    assert patched_dispatcher.enqueue_calls == []


def test_publishable_only_returns_correct_count(patched_dispatcher):
    """Only publishable_rows populated → result equals len(publishable_rows)."""
    patched_dispatcher.publishable_rows.extend([
        {"id": "ev-only", "kill_id": "k-only"},
    ])

    result = asyncio.run(patched_dispatcher.module.run())
    assert result == 1


# ─── Cycle reporting (total counts) ──────────────────────────────────


def test_total_enqueued_sums_across_all_transitions(patched_dispatcher):
    """1 vod_found + 1 clipped + 1 analyzed (×3 jobs) + 1 publishable
    = 1 + 1 + 3 + 1 = 6 total enqueued.
    """
    patched_dispatcher.rows_by_status["vod_found"] = [{"id": "k-vf"}]
    patched_dispatcher.rows_by_status["clipped"] = [{"id": "k-cl"}]
    patched_dispatcher.rows_by_status["analyzed"] = [{"id": "k-an"}]
    patched_dispatcher.publishable_rows.append(
        {"id": "ev-pub", "kill_id": "k-pub"}
    )

    result = asyncio.run(patched_dispatcher.module.run())

    # 1 (clip.create) + 1 (clip.analyze) + 3 (og + embedding + event_map)
    # + 1 (publish.check) = 6
    assert result == 6
    types_count = {}
    for c in patched_dispatcher.enqueue_calls:
        types_count[c["job_type"]] = types_count.get(c["job_type"], 0) + 1
    assert types_count == {
        "clip.create": 1,
        "clip.analyze": 1,
        "og.generate": 1,
        "embedding.compute": 1,
        "event.map": 1,
        "publish.check": 1,
    }


def test_skips_rows_without_id(patched_dispatcher):
    """Rows missing 'id' are silently skipped, not crashed-on."""
    patched_dispatcher.rows_by_status["vod_found"] = [
        {"id": "kill-good"},
        {"not_id": "kill-bad"},  # missing id key
        {"id": ""},                # empty string id is falsy → also skipped
    ]
    asyncio.run(patched_dispatcher.module.run())

    create_calls = [c for c in patched_dispatcher.enqueue_calls
                    if c["job_type"] == "clip.create"]
    # Only the good one
    assert len(create_calls) == 1
    assert create_calls[0]["entity_id"] == "kill-good"


# ─── Manual main runner ──────────────────────────────────────────────

if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v", "-s"]))
