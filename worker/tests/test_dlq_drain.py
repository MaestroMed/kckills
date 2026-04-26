"""Tests for scripts/dlq_drain.py + modules/dlq_drainer.py.

Coverage
--------
The script is centred on `decide_action(db, row)` — a per-row
recovery decision based on error_code (and a couple of conditional
DB lookups for `no_vod` / `publish_failed`).

Tests cover :
  * Each REQUEUE_CODES code -> action='requeue'
  * Each CANCEL_CODES_WITH_REASON code -> action='cancel'
  * `no_vod` with a game that now has vod -> requeue
  * `no_vod` with a game still missing vod -> cancel
  * `publish_failed` with is_publishable=true -> requeue
  * `publish_failed` with is_publishable=false -> cancel
  * `publish_failed` with event row missing -> cancel
  * `clip_kill returned no urls` (msg only, code=clip_failed) -> requeue
  * Unknown error_code with transient message -> requeue
  * Unknown error_code with no transient hint -> requeue (one-more-try)
  * exit_<N> codes -> requeue
  * timeout code -> requeue
  * Daemon : low_power skips the cycle

Strategy
--------
We mock the httpx-backed _fetch_* helpers. The decide_action function
takes a `db` arg so we can pass any sentinel — the helpers it calls
are patched at module scope.
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
def fake_db():
    """Sentinel db object — decide_action passes it to the patched
    _fetch_* helpers but never touches its attributes itself.
    """
    return MagicMock(name="fake_db", base="https://x", headers={})


# ─── Test : codes that always requeue ────────────────────────────────


@pytest.mark.parametrize("code", [
    "youtube_bot_blocked",
    "ytdlp_bot_blocked",
    "clip_failed",
    "publish_exception",
    "runner_crash",
    "internal_error",
    "exec_error",
    "script_missing",
])
def test_requeue_codes_always_requeue(code, fake_db):
    """Every code in REQUEUE_CODES must yield action='requeue'."""
    from scripts.dlq_drain import decide_action

    row = {
        "id": "dlq-1",
        "type": "clip.create",
        "entity_type": "kill",
        "entity_id": "kill-1",
        "payload": {"kill_id": "kill-1", "game_id": "game-1"},
        "error_code": code,
        "error_message": "...",
    }
    action, reason = decide_action(fake_db, row)
    assert action == "requeue", f"{code} should requeue, got {action} ({reason})"
    assert code in reason
    print(f"  [OK] {code} -> requeue ({reason})")


# ─── Test : codes that always cancel ─────────────────────────────────


@pytest.mark.parametrize("code,expected_reason", [
    ("kill_deleted",     "kill_row_missing"),
    ("bad_payload",      "malformed_payload"),
    ("forbidden_script", "security_skip"),
    ("game_missing",     "parent_game_missing"),
])
def test_cancel_codes_always_cancel(code, expected_reason, fake_db):
    """CANCEL_CODES_WITH_REASON must yield action='cancel' with
    the configured reason.
    """
    from scripts.dlq_drain import decide_action

    row = {
        "id": "dlq-1",
        "type": "clip.create",
        "entity_id": "kill-1",
        "payload": {},
        "error_code": code,
        "error_message": "whatever",
    }
    action, reason = decide_action(fake_db, row)
    assert action == "cancel", f"{code} should cancel, got {action}"
    assert reason == expected_reason
    print(f"  [OK] {code} -> cancel ({reason})")


# ─── Test : no_vod conditional ───────────────────────────────────────


def test_no_vod_with_vod_now_set_requeues(monkeypatch, fake_db):
    """A `no_vod` failure where games.vod_youtube_id is now populated
    must requeue (the vod_offset_finder filled it in since).
    """
    from scripts import dlq_drain
    monkeypatch.setattr(dlq_drain, "_fetch_game_vod",
                        lambda db, gid: "abcdef123XYZ")

    row = {
        "type": "clip.create",
        "entity_type": "kill",
        "entity_id": "kill-1",
        "payload": {"kill_id": "kill-1", "game_id": "game-77"},
        "error_code": "no_vod",
        "error_message": "vod_youtube_id null on game",
    }
    action, reason = dlq_drain.decide_action(fake_db, row)
    assert action == "requeue"
    assert "vod_now_available" in reason
    print(f"  [OK] no_vod + vod now set -> requeue ({reason})")


def test_no_vod_still_missing_cancels(monkeypatch, fake_db):
    """A `no_vod` failure where games.vod_youtube_id is STILL null
    must cancel — re-queueing would just fail again with the same code.
    """
    from scripts import dlq_drain
    monkeypatch.setattr(dlq_drain, "_fetch_game_vod", lambda db, gid: None)

    row = {
        "type": "clip.create",
        "entity_type": "kill",
        "entity_id": "kill-1",
        "payload": {"kill_id": "kill-1", "game_id": "game-77"},
        "error_code": "no_vod",
        "error_message": "vod_youtube_id null on game",
    }
    action, reason = dlq_drain.decide_action(fake_db, row)
    assert action == "cancel"
    assert reason == "vod_still_missing"
    print(f"  [OK] no_vod + vod still null -> cancel ({reason})")


def test_no_vod_payload_missing_game_id_falls_back_to_kill_lookup(monkeypatch, fake_db):
    """If payload doesn't carry game_id, decide_action must fall back
    to looking it up via the kill_id -> game_id chain. Then proceed
    with the vod check normally.
    """
    from scripts import dlq_drain
    lookup_calls: list[str] = []

    def fake_kill_game(db, kid):
        lookup_calls.append(kid)
        return "game-from-kill-lookup"

    monkeypatch.setattr(dlq_drain, "_fetch_kill_game_id", fake_kill_game)
    monkeypatch.setattr(dlq_drain, "_fetch_game_vod",
                        lambda db, gid: "yt-abc")

    row = {
        "type": "clip.create",
        "entity_type": "kill",
        "entity_id": "kill-1",
        "payload": {"kill_id": "kill-1"},  # no game_id
        "error_code": "no_vod",
        "error_message": "vod_youtube_id null on game",
    }
    action, reason = dlq_drain.decide_action(fake_db, row)
    assert action == "requeue"
    assert lookup_calls == ["kill-1"]
    print("  [OK] no_vod with missing game_id falls back to kill lookup")


# ─── Test : publish_failed conditional ───────────────────────────────


def test_publish_failed_now_publishable_requeues(monkeypatch, fake_db):
    """publish_failed where game_event.is_publishable went back to true
    (post-qc-fix) must requeue.
    """
    from scripts import dlq_drain
    monkeypatch.setattr(dlq_drain, "_fetch_event_publishable",
                        lambda db, eid: True)

    row = {
        "type": "publish.check",
        "entity_type": "event",
        "entity_id": "event-1",
        "payload": {"event_id": "event-1"},
        "error_code": "publish_failed",
        "error_message": "publish_check returned false",
    }
    action, reason = dlq_drain.decide_action(fake_db, row)
    assert action == "requeue"
    assert reason == "publishable_now_true"
    print(f"  [OK] publish_failed + is_publishable=true -> requeue ({reason})")


def test_publish_failed_still_blocked_cancels(monkeypatch, fake_db):
    """publish_failed where is_publishable is still false must cancel."""
    from scripts import dlq_drain
    monkeypatch.setattr(dlq_drain, "_fetch_event_publishable",
                        lambda db, eid: False)

    row = {
        "type": "publish.check",
        "entity_type": "event",
        "entity_id": "event-1",
        "payload": {},
        "error_code": "publish_failed",
        "error_message": "publish_check returned false",
    }
    action, reason = dlq_drain.decide_action(fake_db, row)
    assert action == "cancel"
    assert reason == "still_not_publishable"
    print(f"  [OK] publish_failed + still blocked -> cancel ({reason})")


def test_publish_failed_event_missing_cancels(monkeypatch, fake_db):
    """publish_failed where the event row is gone must cancel."""
    from scripts import dlq_drain
    monkeypatch.setattr(dlq_drain, "_fetch_event_publishable",
                        lambda db, eid: None)

    row = {
        "type": "publish.check",
        "entity_type": "event",
        "entity_id": "event-1",
        "payload": {},
        "error_code": "publish_failed",
        "error_message": "publish_check returned false",
    }
    action, reason = dlq_drain.decide_action(fake_db, row)
    assert action == "cancel"
    assert reason == "event_row_missing"
    print(f"  [OK] publish_failed + event missing -> cancel ({reason})")


# ─── Test : exit_* / timeout (transient subprocess) ──────────────────


@pytest.mark.parametrize("code", ["exit_1", "exit_2", "exit_127", "timeout"])
def test_subprocess_exit_codes_requeue(code, fake_db):
    """Subprocess failures (admin_job_runner) get one more try."""
    from scripts.dlq_drain import decide_action

    row = {
        "type": "worker.backfill",
        "entity_type": None,
        "entity_id": None,
        "payload": {"script": "backfill_clip_errors"},
        "error_code": code,
        "error_message": "stderr tail : something blew up",
    }
    action, reason = decide_action(fake_db, row)
    assert action == "requeue"
    assert "transient_subprocess_failure" in reason
    print(f"  [OK] {code} -> requeue ({reason})")


# ─── Test : unknown / transient message heuristic ────────────────────


def test_unknown_code_with_transient_message_requeues(fake_db):
    """An unknown error_code whose message looks transient (timeout,
    5xx, rate limit) must requeue.
    """
    from scripts.dlq_drain import decide_action

    row = {
        "type": "clip.create",
        "entity_type": "kill",
        "entity_id": "kill-1",
        "payload": {},
        "error_code": "weird_new_code",
        "error_message": "upstream returned 503 Service Unavailable, timeout after 30s",
    }
    action, reason = decide_action(fake_db, row)
    assert action == "requeue"
    assert "transient_message" in reason
    print(f"  [OK] unknown code + transient message -> requeue ({reason})")


def test_unknown_code_no_hint_gets_one_more_try(fake_db):
    """Unknown error_code with no transient hint defaults to one
    more retry attempt (we'd rather try than lose work).
    """
    from scripts.dlq_drain import decide_action

    row = {
        "type": "clip.create",
        "entity_type": "kill",
        "entity_id": "kill-1",
        "payload": {},
        "error_code": "totally_new_code",
        "error_message": "something deterministic happened",
    }
    action, reason = decide_action(fake_db, row)
    assert action == "requeue"
    assert "unknown_code_one_more_try" in reason
    print(f"  [OK] unknown code + no hint -> requeue ({reason})")


def test_none_error_code_normalised_to_unknown(fake_db):
    """If error_code is None (some legacy fail() calls), we treat
    it as 'unknown' and apply the unknown-code path.
    """
    from scripts.dlq_drain import decide_action

    row = {
        "type": "clip.create",
        "entity_type": "kill",
        "entity_id": "kill-1",
        "payload": {},
        "error_code": None,
        "error_message": "bare exception",
    }
    action, reason = decide_action(fake_db, row)
    # 'unknown' is not in any bucket → fallback to one-more-try.
    assert action == "requeue"
    print(f"  [OK] None error_code -> requeue ({reason})")


# ─── Test : end-to-end drain() with mocked DB ────────────────────────


@pytest.fixture
def patched_drain(monkeypatch, patch_observability, fake_db):
    """Mock _fetch_dlq_page + job_queue.enqueue + _mark_resolved so
    drain() runs end-to-end without network / DB.
    """
    from scripts import dlq_drain
    from services import job_queue

    enqueue_calls: list[dict] = []
    resolve_calls: list[tuple] = []  # (dlq_id, status, note)

    def fake_enqueue(job_type, entity_type, entity_id, payload,
                     priority, run_after, max_attempts):
        enqueue_calls.append({
            "job_type": job_type,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "payload": payload,
            "priority": priority,
        })
        return f"new-job-{entity_id}"

    def fake_resolve(db, dlq_id, *, status, note, new_job_id=None):
        resolve_calls.append((dlq_id, status, note))
        return True

    monkeypatch.setattr(job_queue, "enqueue", fake_enqueue)
    monkeypatch.setattr(dlq_drain.job_queue, "enqueue", fake_enqueue)
    monkeypatch.setattr(dlq_drain, "_mark_resolved", fake_resolve)
    # Always say "vod available" / "publishable" so conditional codes
    # also requeue ; tests above already cover the cancel paths.
    monkeypatch.setattr(dlq_drain, "_fetch_game_vod",
                        lambda db, gid: "yt-id-xyz")
    monkeypatch.setattr(dlq_drain, "_fetch_event_publishable",
                        lambda db, eid: True)
    monkeypatch.setattr(dlq_drain, "_fetch_kill_game_id",
                        lambda db, kid: "game-x")

    class Bag:
        pass
    bag = Bag()
    bag.module = dlq_drain
    bag.enqueue_calls = enqueue_calls
    bag.resolve_calls = resolve_calls
    bag.db = fake_db
    return bag


def test_drain_dry_run_does_no_writes(monkeypatch, patched_drain):
    """--dry-run mode must not enqueue or resolve."""
    fake_rows = [
        {"id": "dlq-1", "type": "clip.create", "entity_type": "kill",
         "entity_id": "kill-1", "payload": {"kill_id": "kill-1"},
         "error_code": "clip_failed", "error_message": "x",
         "attempts": 3, "failed_at": "2026-04-25T00:00:00Z"},
        {"id": "dlq-2", "type": "clip.create", "entity_type": "kill",
         "entity_id": "kill-2", "payload": {"kill_id": "kill-2"},
         "error_code": "kill_deleted", "error_message": "x",
         "attempts": 3, "failed_at": "2026-04-25T00:00:00Z"},
    ]
    monkeypatch.setattr(
        patched_drain.module, "_fetch_dlq_page",
        lambda db, **kw: fake_rows if kw["offset"] == 0 else [],
    )
    summary = asyncio.run(patched_drain.module.drain(
        db=patched_drain.db,
        dry_run=True,
        type_filter=None,
        error_code_filter=None,
        since_days=7,
        limit=None,
    ))
    assert patched_drain.enqueue_calls == []
    assert patched_drain.resolve_calls == []
    assert summary["items_scanned"] == 2
    assert summary["requeued"] == 1
    assert summary["cancelled"] == 1
    print(f"  [OK] dry-run reports {summary['requeued']} requeue + "
          f"{summary['cancelled']} cancel without writes")


def test_drain_real_writes_enqueue_and_resolve(monkeypatch, patched_drain):
    """Non-dry run : enqueue gets called for requeue rows, resolve for
    every row (status differs).
    """
    fake_rows = [
        {"id": "dlq-1", "type": "clip.create", "entity_type": "kill",
         "entity_id": "kill-1", "payload": {"kill_id": "kill-1", "game_id": "g1"},
         "error_code": "clip_failed", "error_message": "x",
         "attempts": 3, "failed_at": "2026-04-25T00:00:00Z"},
        {"id": "dlq-2", "type": "clip.create", "entity_type": "kill",
         "entity_id": "kill-2", "payload": {"kill_id": "kill-2"},
         "error_code": "bad_payload", "error_message": "x",
         "attempts": 3, "failed_at": "2026-04-25T00:00:00Z"},
    ]
    monkeypatch.setattr(
        patched_drain.module, "_fetch_dlq_page",
        lambda db, **kw: fake_rows if kw["offset"] == 0 else [],
    )
    summary = asyncio.run(patched_drain.module.drain(
        db=patched_drain.db,
        dry_run=False,
        type_filter=None,
        error_code_filter=None,
        since_days=7,
        limit=None,
    ))
    # One requeue (clip_failed) + one cancel (bad_payload)
    assert len(patched_drain.enqueue_calls) == 1
    assert patched_drain.enqueue_calls[0]["entity_id"] == "kill-1"
    assert patched_drain.enqueue_calls[0]["priority"] == 30  # REQUEUE_PRIORITY
    # Both rows get a resolve call.
    assert len(patched_drain.resolve_calls) == 2
    statuses = sorted(c[1] for c in patched_drain.resolve_calls)
    assert statuses == ["cancelled", "requeued"]
    assert summary["requeued"] == 1
    assert summary["cancelled"] == 1
    print(f"  [OK] real run did 1 enqueue + 2 resolves")


def test_drain_respects_limit(monkeypatch, patched_drain):
    """--limit caps the total scanned across pages."""
    fake_rows = [
        {"id": f"dlq-{i}", "type": "clip.create", "entity_type": "kill",
         "entity_id": f"kill-{i}",
         "payload": {"kill_id": f"kill-{i}", "game_id": f"g-{i}"},
         "error_code": "clip_failed", "error_message": "x",
         "attempts": 3, "failed_at": "2026-04-25T00:00:00Z"}
        for i in range(10)
    ]

    def fake_page(db, **kw):
        offset = kw["offset"]
        size = kw["page_size"]
        return fake_rows[offset:offset + size]

    monkeypatch.setattr(patched_drain.module, "_fetch_dlq_page", fake_page)

    summary = asyncio.run(patched_drain.module.drain(
        db=patched_drain.db,
        dry_run=False,
        type_filter=None,
        error_code_filter=None,
        since_days=7,
        limit=3,
    ))
    assert summary["items_scanned"] == 3
    assert summary["requeued"] == 3
    print("  [OK] limit caps scan at N rows")


# ─── Test : daemon low_power skip ────────────────────────────────────


def test_daemon_skips_when_low_power(monkeypatch, patch_observability):
    """When KCKILLS_LOW_POWER=1, the daemon must short-circuit."""
    from modules import dlq_drainer

    monkeypatch.setattr(dlq_drainer, "_is_low_power", lambda: True)

    # If anything non-trivial runs we'd touch get_db — make that explode
    # so a regression that ignores the low_power gate fails the test.
    def boom():
        raise RuntimeError("get_db should not be called when low_power=1")
    monkeypatch.setattr(dlq_drainer, "get_db", boom)

    summary = asyncio.run(dlq_drainer.run())
    assert summary["low_power"] is True
    assert summary["items_processed"] == 0
    assert summary["items_skipped"] == 1
    print("  [OK] daemon short-circuits when KCKILLS_LOW_POWER=1")


def test_daemon_runs_normally_when_low_power_off(monkeypatch, patch_observability, fake_db):
    """When KCKILLS_LOW_POWER is not set, the daemon proceeds and uses
    the script's drain() with the cycle cap.
    """
    from modules import dlq_drainer
    from scripts import dlq_drain

    monkeypatch.setattr(dlq_drainer, "_is_low_power", lambda: False)
    monkeypatch.setattr(dlq_drainer, "get_db", lambda: fake_db)

    drain_calls: list[dict] = []

    async def fake_drain(**kwargs):
        drain_calls.append(kwargs)
        return {
            "items_scanned":   3,
            "items_processed": 3,
            "items_failed":    0,
            "items_skipped":   0,
            "requeued":        2,
            "cancelled":       1,
            "errors":          0,
            "by_error_code":   {},
        }

    monkeypatch.setattr(dlq_drain, "drain", fake_drain)

    summary = asyncio.run(dlq_drainer.run())
    assert summary["requeued"] == 2
    assert summary["cancelled"] == 1
    assert len(drain_calls) == 1
    # Daemon caps at MAX_RECOVERIES_PER_CYCLE.
    assert drain_calls[0]["limit"] == dlq_drainer.MAX_RECOVERIES_PER_CYCLE
    assert drain_calls[0]["dry_run"] is False
    print("  [OK] daemon delegates to script.drain() with cycle cap")


# ─── Manual main() runner — for `python tests/test_dlq_drain.py` ──────


def _run_all():
    print("=== dlq_drain Tests ===")
    pytest.main([__file__, "-v", "-s"])


if __name__ == "__main__":
    _run_all()
