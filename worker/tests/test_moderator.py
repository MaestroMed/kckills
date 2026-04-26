"""Tests for the moderator daemon — Wave 7 (Agent AF).

Mocks anthropic + scheduler + supabase_client + job_queue at the module
boundary so the suite is fully deterministic — no network, no DB, no env
vars required.

Coverage :
  * moderate_comment() — degraded modes (no key, rate-limited), Haiku
    success, JSON parse error, exception handling.
  * _coerce_toxicity() — float / int / string / None / NaN sanitisation.
  * run() queue-first path : claims `comment.moderate` jobs from
    pipeline_jobs, fetches the matching comment row, calls Haiku,
    writes the moderation_status + toxicity_score + moderation_reason,
    then succeeds the job.
  * run() legacy fallback : when the queue is empty, scans the table
    for moderation_status='pending' rows AND opportunistically enqueues
    them for the next cycle (bridge during the migration window).
  * Idempotency : a claimed job whose comment row was already moderated
    succeeds with `skipped='already_moderated'` (no Haiku call burned).
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add worker root to path (matches the pattern used by every other test).
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from modules import moderator  # noqa: E402


# ─── Fixtures ────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _reset_module_state(monkeypatch):
    """Make scheduler.wait_for() instant + give the moderator an API key
    so the degraded-mode short-circuit doesn't fire on every test."""
    async def _instant_wait(_service):
        return True
    monkeypatch.setattr(moderator.scheduler, "wait_for", _instant_wait)
    monkeypatch.setattr(moderator.config, "ANTHROPIC_API_KEY", "sk-test-fake-key")
    yield


def _haiku_response(action: str = "approve", reason: str = "ok",
                    toxicity: float = 1.0) -> MagicMock:
    """Build a fake Anthropic SDK message return shape."""
    text = f'{{"action":"{action}","reason":"{reason}","toxicity":{toxicity}}}'
    block = MagicMock()
    block.text = text
    msg = MagicMock()
    msg.content = [block]
    return msg


# ─── moderate_comment() — degraded modes + happy path ───────────────

@pytest.mark.asyncio
async def test_moderate_comment_no_api_key(monkeypatch):
    """Empty ANTHROPIC_API_KEY → auto-approve with reason=no_moderation_key."""
    monkeypatch.setattr(moderator.config, "ANTHROPIC_API_KEY", "")
    result = await moderator.moderate_comment("user", "anything")
    assert result["action"] == "approve"
    assert result["reason"] == "no_moderation_key"
    assert result["toxicity"] == 0


@pytest.mark.asyncio
async def test_moderate_comment_rate_limited(monkeypatch):
    """Scheduler quota exhausted → auto-approve with reason=rate_limited."""
    async def _quota_blocked(_service):
        return False
    monkeypatch.setattr(moderator.scheduler, "wait_for", _quota_blocked)
    result = await moderator.moderate_comment("user", "anything")
    assert result["action"] == "approve"
    assert result["reason"] == "rate_limited"


@pytest.mark.asyncio
async def test_moderate_comment_haiku_approves():
    """Happy path — Haiku returns valid JSON, we parse it cleanly."""
    fake_anthropic = MagicMock()
    fake_client = MagicMock()
    fake_client.messages.create.return_value = _haiku_response("approve", "ok", 0.5)
    fake_anthropic.Anthropic.return_value = fake_client
    with patch.dict(sys.modules, {"anthropic": fake_anthropic}):
        result = await moderator.moderate_comment("Caliste", "GG WP les gars")
    assert result["action"] == "approve"
    assert result["toxicity"] == 0.5
    # Verify the prompt actually went through — the username and content
    # must appear in the user message body.
    call_kwargs = fake_client.messages.create.call_args.kwargs
    assert call_kwargs["model"] == "claude-haiku-4-5-20251001"
    user_msg = call_kwargs["messages"][0]["content"]
    assert "Caliste" in user_msg
    assert "GG WP les gars" in user_msg


@pytest.mark.asyncio
async def test_moderate_comment_haiku_rejects():
    """Toxic content → action=reject is preserved as-is."""
    fake_anthropic = MagicMock()
    fake_client = MagicMock()
    fake_client.messages.create.return_value = _haiku_response("reject", "harassment", 9.5)
    fake_anthropic.Anthropic.return_value = fake_client
    with patch.dict(sys.modules, {"anthropic": fake_anthropic}):
        result = await moderator.moderate_comment("user", "vile content")
    assert result["action"] == "reject"
    assert result["toxicity"] == 9.5


@pytest.mark.asyncio
async def test_moderate_comment_haiku_invalid_json():
    """Haiku returns garbage → flag with toxicity=5 (sit-on-fence default)."""
    fake_anthropic = MagicMock()
    fake_client = MagicMock()
    block = MagicMock()
    block.text = "not json at all"
    msg = MagicMock()
    msg.content = [block]
    fake_client.messages.create.return_value = msg
    fake_anthropic.Anthropic.return_value = fake_client
    with patch.dict(sys.modules, {"anthropic": fake_anthropic}):
        result = await moderator.moderate_comment("user", "anything")
    assert result["action"] == "flag"
    assert result["toxicity"] == 5


@pytest.mark.asyncio
async def test_moderate_comment_haiku_exception():
    """Network/SDK exception → auto-approve so users aren't censored."""
    fake_anthropic = MagicMock()
    fake_client = MagicMock()
    fake_client.messages.create.side_effect = RuntimeError("network down")
    fake_anthropic.Anthropic.return_value = fake_client
    with patch.dict(sys.modules, {"anthropic": fake_anthropic}):
        result = await moderator.moderate_comment("user", "anything")
    assert result["action"] == "approve"
    assert "error: network down" in result["reason"]


# ─── _coerce_toxicity() ─────────────────────────────────────────────

def test_coerce_toxicity_valid_inputs():
    assert moderator._coerce_toxicity(7.5) == 7.5
    assert moderator._coerce_toxicity(0) == 0.0
    assert moderator._coerce_toxicity("3.2") == 3.2
    assert moderator._coerce_toxicity(10) == 10.0


def test_coerce_toxicity_invalid_inputs():
    assert moderator._coerce_toxicity(None) is None
    assert moderator._coerce_toxicity("not a number") is None
    # NaN / Inf are rejected
    assert moderator._coerce_toxicity(float("nan")) is None
    assert moderator._coerce_toxicity(float("inf")) is None


def test_status_map_covers_all_haiku_actions():
    """The action→moderation_status map handles every Haiku output."""
    assert moderator._NEW_STATUS_MAP["approve"] == "approved"
    assert moderator._NEW_STATUS_MAP["flag"] == "flagged"
    assert moderator._NEW_STATUS_MAP["reject"] == "rejected"


# ─── run() — queue-first path ───────────────────────────────────────

@pytest.mark.asyncio
async def test_run_queue_path_writes_moderation_state():
    """A claimed `comment.moderate` job → Haiku call → safe_update + succeed."""
    job = {
        "id": "job-1",
        "type": "comment.moderate",
        "entity_type": "comment",
        "entity_id": "comment-uuid-1",
    }
    comment_row = {
        "id": "comment-uuid-1",
        "content": "Caliste sale joueur de la mort",
        "user_id": "user-1",
        "kill_id": "kill-1",
        "moderation_status": "pending",
    }

    fake_anthropic = MagicMock()
    fake_client = MagicMock()
    fake_client.messages.create.return_value = _haiku_response("flag", "trash_talk", 4.0)
    fake_anthropic.Anthropic.return_value = fake_client

    update_calls: list[tuple[str, dict, str, str]] = []
    succeed_calls: list[tuple[str, dict | None]] = []

    def fake_update(table, data, col, val):
        update_calls.append((table, data, col, val))
        return True

    def fake_succeed(jid, result=None):
        succeed_calls.append((jid, result))
        return True

    def fake_safe_select(table, columns="*", **filters):
        # The moderator does TWO kinds of selects in the queue path :
        #   1. comments WHERE id=<comment_id>
        #   2. profiles WHERE id=<user_id>
        if table == "comments" and filters.get("id") == "comment-uuid-1":
            return [comment_row]
        if table == "profiles" and filters.get("id") == "user-1":
            return [{"id": "user-1", "discord_username": "EtoStark"}]
        return []

    with patch.dict(sys.modules, {"anthropic": fake_anthropic}), \
         patch.object(moderator.job_queue, "claim", return_value=[job]), \
         patch.object(moderator.job_queue, "succeed", side_effect=fake_succeed), \
         patch("services.supabase_client.safe_select", side_effect=fake_safe_select), \
         patch("services.supabase_client.safe_update", side_effect=fake_update):
        moderated = await moderator.run()

    assert moderated == 1
    # The @run_logged() decorator also writes to pipeline_runs at end of
    # run() — filter to just the comments-table writes to assert moderation.
    comment_updates = [u for u in update_calls if u[0] == "comments"]
    assert len(comment_updates) == 1
    table, patch_body, col, val = comment_updates[0]
    assert col == "id"
    assert val == "comment-uuid-1"
    assert patch_body["moderation_status"] == "flagged"
    assert patch_body["moderation_reason"] == "trash_talk"
    assert patch_body["toxicity_score"] == 4.0
    # Job was acked successfully
    assert succeed_calls == [("job-1", {"action": "flag", "toxicity": 4.0})]


@pytest.mark.asyncio
async def test_run_queue_path_skips_already_moderated_comment():
    """A queue claim on a comment that's already non-pending → succeed
    with skipped reason, NO Haiku call burned."""
    job = {
        "id": "job-1",
        "type": "comment.moderate",
        "entity_type": "comment",
        "entity_id": "comment-uuid-1",
    }
    comment_row = {
        "id": "comment-uuid-1",
        "content": "anything",
        "user_id": "user-1",
        "moderation_status": "approved",  # already moderated
    }

    succeed_calls: list[tuple[str, dict | None]] = []

    def fake_safe_select(table, columns="*", **filters):
        if table == "comments":
            return [comment_row]
        return []

    fake_anthropic = MagicMock()
    fake_anthropic.Anthropic.return_value.messages.create = MagicMock(
        side_effect=AssertionError("Haiku must NOT be called for already-moderated rows")
    )

    with patch.dict(sys.modules, {"anthropic": fake_anthropic}), \
         patch.object(moderator.job_queue, "claim", return_value=[job]), \
         patch.object(moderator.job_queue, "succeed",
                      side_effect=lambda jid, r=None: succeed_calls.append((jid, r))), \
         patch("services.supabase_client.safe_select", side_effect=fake_safe_select), \
         patch("services.supabase_client.safe_update", return_value=True):
        moderated = await moderator.run()

    assert moderated == 0
    assert succeed_calls == [("job-1", {"skipped": "already_moderated"})]


@pytest.mark.asyncio
async def test_run_queue_path_missing_comment_row_dead_letters():
    """A queue claim whose comment row has been deleted → fail with
    error_code=comment_deleted (long retry)."""
    job = {
        "id": "job-1",
        "type": "comment.moderate",
        "entity_type": "comment",
        "entity_id": "comment-uuid-1",
    }
    fail_calls: list[tuple[str, str, int, str]] = []

    def fake_fail(jid, msg, retry_seconds, code):
        fail_calls.append((jid, msg, retry_seconds, code))
        return True

    with patch.object(moderator.job_queue, "claim", return_value=[job]), \
         patch.object(moderator.job_queue, "fail", side_effect=fake_fail), \
         patch("services.supabase_client.safe_select", return_value=[]), \
         patch("services.supabase_client.safe_update", return_value=True):
        moderated = await moderator.run()

    assert moderated == 0
    assert len(fail_calls) == 1
    assert fail_calls[0][3] == "comment_deleted"


# ─── run() — legacy fallback ────────────────────────────────────────

@pytest.mark.asyncio
async def test_run_legacy_fallback_processes_pending_when_queue_empty():
    """No claimed jobs → fall back to scanning comments AND enqueue them
    for the next cycle's queue-first run."""
    pending_comments = [
        {
            "id": "comment-uuid-A",
            "content": "premier",
            "user_id": "user-A",
            "kill_id": "kill-1",
            "moderation_status": "pending",
        },
        {
            "id": "comment-uuid-B",
            "content": "deuxieme",
            "user_id": "user-B",
            "kill_id": "kill-1",
            "moderation_status": "pending",
        },
    ]
    profiles = [
        {"id": "user-A", "discord_username": "Caliste"},
        {"id": "user-B", "discord_username": "Yike"},
    ]

    enqueue_calls: list[tuple[Any, ...]] = []
    update_calls: list[tuple[str, dict]] = []

    fake_anthropic = MagicMock()
    fake_client = MagicMock()
    fake_client.messages.create.return_value = _haiku_response("approve", "ok", 1.0)
    fake_anthropic.Anthropic.return_value = fake_client

    def fake_safe_select(table, columns="*", **filters):
        if table == "comments" and filters.get("moderation_status") == "pending":
            return pending_comments
        if table == "profiles" and not filters:
            return profiles
        return []

    def fake_update(table, data, col, val):
        update_calls.append((val, data))
        return True

    def fake_enqueue(*args, **kwargs):
        enqueue_calls.append((args, kwargs))
        return "new-job-id"

    with patch.dict(sys.modules, {"anthropic": fake_anthropic}), \
         patch.object(moderator.job_queue, "claim", return_value=[]), \
         patch.object(moderator.job_queue, "enqueue", side_effect=fake_enqueue), \
         patch("services.supabase_client.safe_select", side_effect=fake_safe_select), \
         patch("services.supabase_client.safe_update", side_effect=fake_update):
        moderated = await moderator.run()

    # Both comments processed by Haiku + DB write. The @run_logged()
    # decorator also writes a pipeline_runs row — filter to the moderation
    # writes (id starts with "comment-uuid-" in our fixture).
    assert moderated == 2
    moderation_writes = {c[0] for c in update_calls if c[0].startswith("comment-uuid-")}
    assert moderation_writes == {"comment-uuid-A", "comment-uuid-B"}
    # Both rows enqueued for the next cycle's queue-first path
    assert len(enqueue_calls) == 2
    enqueued_types = [args[0] for args, _ in enqueue_calls]
    assert all(t == "comment.moderate" for t in enqueued_types)


@pytest.mark.asyncio
async def test_run_legacy_fallback_no_pending_comments_returns_zero():
    """Nothing to do → return 0, never call Haiku."""
    fake_anthropic = MagicMock()
    fake_anthropic.Anthropic.return_value.messages.create = MagicMock(
        side_effect=AssertionError("Haiku must NOT be called")
    )

    with patch.dict(sys.modules, {"anthropic": fake_anthropic}), \
         patch.object(moderator.job_queue, "claim", return_value=[]), \
         patch("services.supabase_client.safe_select", return_value=[]):
        moderated = await moderator.run()

    assert moderated == 0
