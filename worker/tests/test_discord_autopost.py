"""Tests for the discord_autopost daemon.

Mocks httpx + supabase_client at the module boundary so the suite is
fully deterministic — no network, no DB, no env vars required.
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Add worker root to path (matches the pattern in test_harvester.py)
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from modules import discord_autopost  # noqa: E402


# ─── Helpers ──────────────────────────────────────────────────────────

def _make_kill(
    *,
    kill_id: str = "11111111-2222-3333-4444-555555555555",
    score: float | None = 9.0,
    multi: str | None = None,
    desc: str = "Solo kill propre de Caliste",
    tags: list[str] | None = None,
    is_first_blood: bool = False,
    thumb: str | None = "https://r2.example/clips/x_thumb.jpg",
    created_at: str = "2026-04-24T10:00:00+00:00",
) -> dict[str, Any]:
    return {
        "id": kill_id,
        "killer_champion": "Jinx",
        "victim_champion": "Aphelios",
        "ai_description": desc,
        "highlight_score": score,
        "ai_tags": tags or ["outplay", "solo_kill", "mechanical"],
        "multi_kill": multi,
        "is_first_blood": is_first_blood,
        "thumbnail_url": thumb,
        "clip_url_vertical": "https://r2.example/clips/x_v.mp4",
        "created_at": created_at,
    }


def _mock_response(status: int, json_body: Any | None = None,
                   headers: dict[str, str] | None = None):
    resp = MagicMock()
    resp.status_code = status
    resp.headers = headers or {}
    if json_body is not None:
        resp.json = MagicMock(return_value=json_body)
    else:
        resp.json = MagicMock(side_effect=ValueError("no body"))
    resp.text = ""
    return resp


class _FakeAsyncClient:
    """Drop-in replacement for httpx.AsyncClient that records POST calls."""

    def __init__(self, responses: list):
        self._responses = list(responses)
        self.posts: list[tuple[str, dict]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return None

    async def post(self, url: str, json: dict, timeout: float = 10.0):
        self.posts.append((url, json))
        if not self._responses:
            return _mock_response(200)
        return self._responses.pop(0)


# Auto-fixture : reset the module-level "logged once" latch + scheduler
# state between tests so cases don't bleed into each other.
@pytest.fixture(autouse=True)
def _reset_module_state(monkeypatch):
    discord_autopost._no_webhook_logged = False
    # Make scheduler.wait_for() instant so tests don't sleep 2.5s/call.
    async def _instant_wait(_service):
        return True
    monkeypatch.setattr(discord_autopost.scheduler, "wait_for", _instant_wait)
    # Default webhook URL — individual tests override with monkeypatch.
    monkeypatch.setattr(discord_autopost.config, "DISCORD_WEBHOOK_URL", "https://discord.test/wh/abc")
    # Avoid pytest seeing real env var. Default min score = 8.0.
    monkeypatch.delenv("DISCORD_AUTOPOST_MIN_SCORE", raising=False)
    yield


# ─── Embed shape (pure function) ──────────────────────────────────────

def test_embed_basic_shape():
    """Standard embed has gold border, title with arrow, score field, kill URL."""
    kill = _make_kill()
    embed = discord_autopost._build_embed(kill)
    assert embed["color"] == 0xC8AA6E
    assert "Jinx" in embed["title"]
    assert "Aphelios" in embed["title"]
    assert "\u2192" in embed["title"]  # → arrow
    assert embed["url"].endswith(kill["id"])
    # Score field present and formatted to one decimal
    score_field = next(f for f in embed["fields"] if f["name"] == "Score")
    assert score_field["value"] == "9.0/10"
    # Match link field present
    assert any(f["name"] == "Match" for f in embed["fields"])
    # Footer per spec
    assert "highlight auto-pick" in embed["footer"]["text"]
    # Image set from thumbnail_url
    assert embed["image"]["url"] == kill["thumbnail_url"]


def test_embed_pentakill_prefix():
    """multi_kill='penta' produces the 🔥 PENTAKILL prefix."""
    kill = _make_kill(multi="penta")
    embed = discord_autopost._build_embed(kill)
    assert embed["title"].startswith("\U0001F525 PENTAKILL")  # 🔥
    assert "Jinx" in embed["title"]


def test_embed_quadra_and_triple_prefix():
    """Other multi-kill tiers get appropriate prefixes."""
    quadra = discord_autopost._build_embed(_make_kill(multi="quadra"))
    assert "QUADRA" in quadra["title"]
    triple = discord_autopost._build_embed(_make_kill(multi="triple"))
    assert "TRIPLE" in triple["title"]


def test_embed_truncates_long_description():
    """ai_description over 300 chars gets truncated."""
    long_desc = "A" * 1000
    kill = _make_kill(desc=long_desc)
    embed = discord_autopost._build_embed(kill)
    assert len(embed["description"]) == 300


def test_embed_first_blood_field():
    """is_first_blood=True surfaces a Contexte field."""
    kill = _make_kill(is_first_blood=True)
    embed = discord_autopost._build_embed(kill)
    contexts = [f for f in embed["fields"] if f["name"] == "Contexte"]
    assert len(contexts) == 1
    assert "First Blood" in contexts[0]["value"]


def test_embed_top_3_tags_only():
    """Only first 3 ai_tags appear in the Tags field."""
    kill = _make_kill(tags=["a", "b", "c", "d", "e"])
    embed = discord_autopost._build_embed(kill)
    tags_field = next(f for f in embed["fields"] if f["name"] == "Tags")
    assert "a" in tags_field["value"]
    assert "c" in tags_field["value"]
    assert "d" not in tags_field["value"]


# ─── Daemon end-to-end (mocked DB + httpx) ────────────────────────────

@pytest.mark.asyncio
async def test_high_score_kill_posted_and_stamped():
    """A kill with score >= 8.0 gets POSTed and discord_posted_at stamped."""
    kill = _make_kill(score=9.0)
    fake_client = _FakeAsyncClient([_mock_response(204)])

    stamp_calls: list[str] = []

    def fake_stamp(kill_id: str) -> bool:
        stamp_calls.append(kill_id)
        return True

    with patch.object(discord_autopost, "_fetch_eligible", return_value=[kill]), \
         patch.object(discord_autopost, "get_db", return_value=MagicMock()), \
         patch.object(discord_autopost, "_stamp_posted", side_effect=fake_stamp), \
         patch.object(discord_autopost.httpx, "AsyncClient", return_value=fake_client):
        posted = await discord_autopost.run()

    assert posted == 1
    assert len(fake_client.posts) == 1
    url, payload = fake_client.posts[0]
    assert url == "https://discord.test/wh/abc"
    assert payload["content"] == ""
    assert len(payload["embeds"]) == 1
    assert payload["embeds"][0]["color"] == 0xC8AA6E
    assert stamp_calls == [kill["id"]]


@pytest.mark.asyncio
async def test_low_score_kill_skipped():
    """The DB query filters out score < threshold — daemon posts nothing."""
    # Simulate _fetch_eligible already filtering by min_score (because the
    # PostgREST gte filter is applied at query time). With threshold 8.0
    # and no eligible rows returned, the daemon must short-circuit.
    fake_client = _FakeAsyncClient([])

    with patch.object(discord_autopost, "_fetch_eligible", return_value=[]), \
         patch.object(discord_autopost, "get_db", return_value=MagicMock()), \
         patch.object(discord_autopost.httpx, "AsyncClient", return_value=fake_client):
        posted = await discord_autopost.run()

    assert posted == 0
    assert fake_client.posts == []


@pytest.mark.asyncio
async def test_already_posted_kill_excluded_by_query():
    """Kills with discord_posted_at NOT NULL never reach the daemon body.

    The DB query has `discord_posted_at: is.null` so already-posted kills
    don't appear in _fetch_eligible's result — verify the daemon does
    nothing when the query returns empty.
    """
    fake_client = _FakeAsyncClient([])
    stamp_calls: list[str] = []

    with patch.object(discord_autopost, "_fetch_eligible", return_value=[]), \
         patch.object(discord_autopost, "get_db", return_value=MagicMock()), \
         patch.object(discord_autopost, "_stamp_posted",
                      side_effect=lambda kid: stamp_calls.append(kid) or True), \
         patch.object(discord_autopost.httpx, "AsyncClient", return_value=fake_client):
        posted = await discord_autopost.run()

    assert posted == 0
    assert stamp_calls == []
    assert fake_client.posts == []


@pytest.mark.asyncio
async def test_429_skips_rest_of_batch_no_db_update():
    """A 429 on one kill skips the rest of the batch and never stamps it."""
    kill_a = _make_kill(kill_id="aaaaaaaa-1111-2222-3333-444444444444", score=9.0)
    kill_b = _make_kill(kill_id="bbbbbbbb-1111-2222-3333-444444444444", score=8.5)
    kill_c = _make_kill(kill_id="cccccccc-1111-2222-3333-444444444444", score=8.2)

    fake_client = _FakeAsyncClient([
        _mock_response(204),                                        # kill_a posts ok
        _mock_response(429, json_body={"retry_after": 3.0}),       # kill_b rate-limited
        # kill_c MUST NOT be posted because we bail after 429
    ])
    stamp_calls: list[str] = []

    def fake_stamp(kill_id: str) -> bool:
        stamp_calls.append(kill_id)
        return True

    with patch.object(discord_autopost, "_fetch_eligible",
                      return_value=[kill_a, kill_b, kill_c]), \
         patch.object(discord_autopost, "get_db", return_value=MagicMock()), \
         patch.object(discord_autopost, "_stamp_posted", side_effect=fake_stamp), \
         patch.object(discord_autopost.httpx, "AsyncClient", return_value=fake_client):
        posted = await discord_autopost.run()

    # kill_a stamped, kill_b NOT stamped (429), kill_c never attempted
    assert posted == 1
    assert stamp_calls == [kill_a["id"]]
    assert len(fake_client.posts) == 2  # kill_a + kill_b only
    # Both rate-limited and kill_c stay unposted, will retry next cycle


@pytest.mark.asyncio
async def test_5xx_response_leaves_kill_unposted():
    """A 503 response does NOT stamp discord_posted_at — retried next cycle."""
    kill = _make_kill(score=9.0)
    fake_client = _FakeAsyncClient([_mock_response(503)])
    stamp_calls: list[str] = []

    with patch.object(discord_autopost, "_fetch_eligible", return_value=[kill]), \
         patch.object(discord_autopost, "get_db", return_value=MagicMock()), \
         patch.object(discord_autopost, "_stamp_posted",
                      side_effect=lambda kid: stamp_calls.append(kid) or True), \
         patch.object(discord_autopost.httpx, "AsyncClient", return_value=fake_client):
        posted = await discord_autopost.run()

    assert posted == 0
    assert stamp_calls == []
    assert len(fake_client.posts) == 1


@pytest.mark.asyncio
async def test_missing_webhook_no_op_no_crash(monkeypatch):
    """Empty DISCORD_WEBHOOK_URL → daemon returns 0, never POSTs, never crashes."""
    monkeypatch.setattr(discord_autopost.config, "DISCORD_WEBHOOK_URL", "")

    fake_client = _FakeAsyncClient([])
    fetch_called = False

    def _fetch_marker(*a, **kw):
        nonlocal fetch_called
        fetch_called = True
        return []

    with patch.object(discord_autopost, "_fetch_eligible", side_effect=_fetch_marker), \
         patch.object(discord_autopost.httpx, "AsyncClient", return_value=fake_client):
        posted = await discord_autopost.run()

    assert posted == 0
    # Should bail BEFORE even calling the DB query.
    assert fetch_called is False
    assert fake_client.posts == []


@pytest.mark.asyncio
async def test_missing_webhook_logs_only_once():
    """Successive runs with missing webhook log warning only once."""
    discord_autopost.config.DISCORD_WEBHOOK_URL = ""

    with patch.object(discord_autopost, "log") as mock_log:
        await discord_autopost.run()
        await discord_autopost.run()
        await discord_autopost.run()
        # Only one info call for "skip_no_webhook" across 3 cycles
        skip_calls = [
            c for c in mock_log.info.call_args_list
            if c[0] and c[0][0] == "discord_autopost_skip_no_webhook"
        ]
        assert len(skip_calls) == 1
