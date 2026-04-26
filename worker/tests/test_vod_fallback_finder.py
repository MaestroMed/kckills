"""Tests for modules/vod_fallback_finder.py (Wave 2 daemon).

Coverage
--------
The vod_fallback_finder daemon scans games with vod_youtube_id IS NULL,
finds reconciled channel_videos linked to the parent match, and copies
the highest-priority source onto games + game_vod_sources.

We exercise:
  * happy path: 1 game + 1 reconciled video (lec_highlights, prio=100)
    → upsert into game_vod_sources AND promote onto games.vod_youtube_id
  * priority ordering: official_lec=100 > team_official=50 > kameto=25
    so the daemon picks the official LEC video as the "best"
  * idempotency: when game already has vod_youtube_id, _games_missing_vod
    returns nothing — the daemon is a no-op
  * empty pool: when no game_vod_sources rows exist for any game's
    parent match, the daemon scans games but skips them all
  * the _role_to_source mapper produces the documented (source_type,
    priority) tuples for each known channel role
  * _pick_for_game's per-game "Game N" filter logic + multi-game
    compilation priority haircut

Strategy
--------
All Supabase + httpx calls are monkey-patched at the boundaries the
daemon imports them from. No network, no actual DB. Fast deterministic
tests.
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
    """Minimal stand-in for the SupabaseRest singleton."""
    db = MagicMock(name="fake_db")
    db.base = "https://example.supabase.co/rest/v1"
    db.headers = {"apikey": "k", "Authorization": "Bearer k"}
    return db


@pytest.fixture
def patched_module(monkeypatch, fake_db, patch_observability):
    """Import vod_fallback_finder + wire generic patches.

    Returns a struct with the imported module and capture lists for
    upsert + promote calls so individual tests can assert on them.
    """
    from modules import vod_fallback_finder as mod

    upsert_calls: list[dict] = []
    promote_calls: list[tuple[str, str]] = []

    def fake_upsert(game_id, video_id, source_type, priority):
        upsert_calls.append({
            "game_id": game_id,
            "video_id": video_id,
            "source_type": source_type,
            "priority": priority,
        })
        return True

    def fake_promote(game_id, video_id):
        promote_calls.append((game_id, video_id))
        return True

    monkeypatch.setattr(mod, "_upsert_source", fake_upsert)
    monkeypatch.setattr(mod, "_promote_to_games", fake_promote)
    monkeypatch.setattr(mod, "get_db", lambda: fake_db)

    class Bag:
        pass
    bag = Bag()
    bag.module = mod
    bag.upsert_calls = upsert_calls
    bag.promote_calls = promote_calls
    return bag


# ─── _role_to_source unit tests (pure logic, no patches needed) ──────


def test_role_to_source_lec_highlights():
    """Riot LEC channel → official_lec, priority=100."""
    from modules.vod_fallback_finder import _role_to_source
    assert _role_to_source("lec_highlights") == ("official_lec", 100)


def test_role_to_source_team_official():
    """KC official channel → other, priority=50."""
    from modules.vod_fallback_finder import _role_to_source
    assert _role_to_source("team_official") == ("other", 50)


def test_role_to_source_streamer():
    """Streamer roles map to kameto, priority=25."""
    from modules.vod_fallback_finder import _role_to_source
    assert _role_to_source("streamer_clips") == ("kameto", 25)
    assert _role_to_source("streamer_vod") == ("kameto", 25)


def test_role_to_source_unknown_role():
    """Unrecognised role → other, priority=10 (lowest)."""
    from modules.vod_fallback_finder import _role_to_source
    assert _role_to_source("anything_else") == ("other", 10)
    assert _role_to_source(None) == ("other", 10)


# ─── _pick_for_game logic ────────────────────────────────────────────


def test_pick_for_game_filters_by_game_n_tag():
    """Video with matched_game_number=2 must NOT be returned for game 1."""
    from modules.vod_fallback_finder import _pick_for_game
    videos = [
        {"id": "vid1", "title": "KC vs G2 Game 2", "matched_game_number": 2,
         "channels": {"role": "lec_highlights"}},
    ]
    out = _pick_for_game(videos, game_number=1)
    assert out == [], "video tagged Game 2 must be excluded for game 1"


def test_pick_for_game_priority_haircut_for_match_wide_compilation():
    """A no-Game-N video for a known game gets a -30 priority haircut."""
    from modules.vod_fallback_finder import _pick_for_game
    videos = [
        {"id": "vid1", "title": "KC vs G2 Highlights",
         "matched_game_number": None,
         "channels": {"role": "lec_highlights"}},
    ]
    out = _pick_for_game(videos, game_number=1)
    assert len(out) == 1
    _, src_type, prio = out[0]
    assert src_type == "official_lec"
    # base 100 - 30 (compilation haircut) = 70
    assert prio == 70


def test_pick_for_game_sorts_by_descending_priority():
    """Multiple sources should be sorted highest-priority first."""
    from modules.vod_fallback_finder import _pick_for_game
    videos = [
        {"id": "kameto", "title": "KC vs G2 Game 1",
         "matched_game_number": 1,
         "channels": {"role": "streamer_clips"}},
        {"id": "official", "title": "KC vs G2 Game 1",
         "matched_game_number": 1,
         "channels": {"role": "lec_highlights"}},
        {"id": "team", "title": "KC vs G2 Game 1",
         "matched_game_number": 1,
         "channels": {"role": "team_official"}},
    ]
    out = _pick_for_game(videos, game_number=1)
    # Sorted: official_lec(100) > team_official(50) > kameto(25)
    assert [v[0]["id"] for v in out] == ["official", "team", "kameto"]
    assert [t[2] for t in out] == [100, 50, 25]


# ─── Daemon-level tests ──────────────────────────────────────────────


def test_run_no_db_returns_zero(monkeypatch, patch_observability):
    """If get_db() returns None, the daemon logs and returns 0."""
    from modules import vod_fallback_finder as mod

    monkeypatch.setattr(mod, "get_db", lambda: None)
    result = asyncio.run(mod.run())
    assert result == 0


def test_run_no_pending_games_returns_zero(monkeypatch, patched_module):
    """If _games_missing_vod returns [], daemon is a clean no-op."""
    mod = patched_module.module
    monkeypatch.setattr(mod, "_games_missing_vod", lambda db, limit: [])
    result = asyncio.run(mod.run())
    assert result == 0
    assert patched_module.upsert_calls == []
    assert patched_module.promote_calls == []


def test_run_promotes_official_lec_video_to_game(monkeypatch, patched_module):
    """Happy path: 1 game w/ NULL vod_youtube_id + 1 reconciled LEC
    highlights video → upsert source row + promote onto games."""
    mod = patched_module.module

    fake_games = [
        {
            "id": "game-001",
            "external_id": "ext-game-001",
            "game_number": 1,
            "vod_youtube_id": None,
            "match": {"external_id": "match-abc", "scheduled_at": "2026-04-01T00:00:00Z"},
        },
    ]
    fake_videos_for_match = {
        "match-abc": [
            {
                "id": "yt-vid-abc",
                "channel_id": "ch-lec",
                "title": "KC vs G2 | HIGHLIGHTS | LEC Spring Game 1",
                "published_at": "2026-04-01T22:00:00Z",
                "duration_seconds": 600,
                "matched_game_number": 1,
                "kc_relevance_score": 0.9,
                "channels": {"role": "lec_highlights"},
            },
        ],
    }

    monkeypatch.setattr(mod, "_games_missing_vod", lambda db, limit: fake_games)
    monkeypatch.setattr(
        mod, "_videos_for_match",
        lambda db, mext: fake_videos_for_match.get(mext, []),
    )

    result = asyncio.run(mod.run())

    # 1 game promoted
    assert result == 1
    assert patched_module.promote_calls == [("game-001", "yt-vid-abc")]
    # 1 source row upserted
    assert len(patched_module.upsert_calls) == 1
    call = patched_module.upsert_calls[0]
    assert call["game_id"] == "game-001"
    assert call["video_id"] == "yt-vid-abc"
    assert call["source_type"] == "official_lec"
    assert call["priority"] == 100


def test_run_picks_highest_priority_among_multiple_sources(
    monkeypatch, patched_module,
):
    """When several reconciled videos exist for the match, the daemon
    promotes the highest priority (official_lec=100 over kameto=25)."""
    mod = patched_module.module

    fake_games = [
        {
            "id": "game-002",
            "external_id": "ext-game-002",
            "game_number": 1,
            "vod_youtube_id": None,
            "match": {"external_id": "match-xyz"},
        },
    ]
    fake_videos_for_match = {
        "match-xyz": [
            {
                "id": "yt-kameto",
                "title": "KC vs G2 Game 1",
                "matched_game_number": 1,
                "channels": {"role": "streamer_clips"},
            },
            {
                "id": "yt-official",
                "title": "KC vs G2 | HIGHLIGHTS | Game 1",
                "matched_game_number": 1,
                "channels": {"role": "lec_highlights"},
            },
        ],
    }

    monkeypatch.setattr(mod, "_games_missing_vod", lambda db, limit: fake_games)
    monkeypatch.setattr(
        mod, "_videos_for_match",
        lambda db, mext: fake_videos_for_match.get(mext, []),
    )

    result = asyncio.run(mod.run())
    assert result == 1
    # Promoted = single highest-priority video.
    assert patched_module.promote_calls == [("game-002", "yt-official")]

    # BOTH sources should be upserted (one row per source_type), so
    # later admin ops can swap.
    upserted_videos = [c["video_id"] for c in patched_module.upsert_calls]
    assert "yt-official" in upserted_videos
    assert "yt-kameto" in upserted_videos
    # The official LEC priority MUST be the highest in the calls.
    official_call = next(c for c in patched_module.upsert_calls
                         if c["video_id"] == "yt-official")
    kameto_call = next(c for c in patched_module.upsert_calls
                       if c["video_id"] == "yt-kameto")
    assert official_call["priority"] > kameto_call["priority"]


def test_run_skips_when_no_videos_for_match(monkeypatch, patched_module):
    """Game has NULL vod_youtube_id, but no reconciled videos → no-op."""
    mod = patched_module.module

    fake_games = [
        {
            "id": "game-empty",
            "external_id": "ext-empty",
            "game_number": 1,
            "vod_youtube_id": None,
            "match": {"external_id": "match-no-videos"},
        },
    ]
    monkeypatch.setattr(mod, "_games_missing_vod", lambda db, limit: fake_games)
    monkeypatch.setattr(mod, "_videos_for_match", lambda db, mext: [])

    result = asyncio.run(mod.run())
    assert result == 0
    assert patched_module.upsert_calls == []
    assert patched_module.promote_calls == []


def test_run_no_op_when_game_already_has_vod(monkeypatch, patched_module):
    """The _games_missing_vod query filters vod_youtube_id IS NULL, so a
    game that already has a VOD never reaches the daemon. We simulate
    that by returning [] from _games_missing_vod and asserting nothing
    else happens — guards against accidental clobbering."""
    mod = patched_module.module

    # Game has vod_youtube_id set — _games_missing_vod would never include it
    monkeypatch.setattr(mod, "_games_missing_vod", lambda db, limit: [])
    monkeypatch.setattr(mod, "_videos_for_match", lambda db, mext: [
        {"id": "yt-fresh", "title": "x", "channels": {"role": "lec_highlights"}},
    ])

    result = asyncio.run(mod.run())
    # Nothing should have been promoted because the game wasn't returned.
    assert result == 0
    assert patched_module.promote_calls == []


# ─── Manual main runner ──────────────────────────────────────────────


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v", "-s"]))
