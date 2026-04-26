"""Tests for modules/channel_reconciler.py v4 (Wave 8 / PR-arch P3).

V4 adds a CLASSIFY-AND-SKIP fast path BEFORE the regex parser runs, so
the 50+ "Karmine Life #N" videos per cycle on Kameto Karmine no longer
spam `unparseable` warnings. The classifier returns one of 8 kinds :

    match | highlight | vlog | reveal | reaction | interview | drama | irrelevant

Coverage in this file
---------------------
    1.  Classifier on a real "Karmine Life #45" title  -> "vlog"
    2.  Classifier on a roster reveal                  -> "reveal"
    3.  Classifier on a "Kameto réagit"               -> "reaction"
    4.  Classifier on a "1ère interview de Caliste"   -> "interview"
    5.  Classifier on "X explique tout"               -> "drama"
    6.  Classifier on a Valorant title                -> "irrelevant"
    7.  Classifier on a real LEC highlight title      -> "highlight"
    8.  Classifier on a "KC vs. KOI | LEC | Game 2"   -> "match"
    9.  Classifier on empty / pure noise              -> "irrelevant"
   10.  Parser : "KC vs. KOI | LEC | Game 2"          -> game_n=2
   11.  Parser : Valorant title returns None (KC mention but non-LoL)
   12.  Parser : Karmine Corp Highlights (vague)      -> None
   13.  Fuzzy : single recent KC match -> external_id returned
   14.  Fuzzy : zero / multiple matches -> None (ambiguous)
   15.  reconcile_one : a vlog row is marked status='skipped_vlog'
   16.  reconcile_one : an interview row is marked status='skipped_interview'
   17.  Sanity : v3 SKIP_KINDS / PARSE_KINDS sets are correct & disjoint

Strategy
--------
The classifier is pure → tested directly.
`reconcile_one` is async + writes to Supabase via safe_update so we
patch `safe_update` to capture the write payload. find_match_candidates
is patched away on rows that we don't want to drive into a network call.
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

# Add worker root to sys.path before importing.
_WORKER_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _WORKER_ROOT)

# Stub env so config.py doesn't refuse to import.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")


# ─── 8-way classifier tests ───────────────────────────────────────────


# Real-world titles observed in production logs (Kameto Karmine channel,
# LEC official, Kameto Clips, Karmine Corp official).
@pytest.mark.parametrize(
    "title, expected",
    [
        # 1. Vlog — the spammiest bucket on Kameto Karmine
        ("Karmine Life #45 - On suit Caliste à la salle",  "vlog"),
        ("KARMINE LIFE #112",                              "vlog"),
        ("Behind the Scenes - LEC Spring 2026",            "vlog"),
        ("Vlog : 24h avec Yike avant la finale",           "vlog"),
        # 2. Reveal — roster annonces, jersey drops, bundle launches
        ("ANNONCE : Notre nouveau toplaner pour 2026",     "reveal"),
        ("ROSTER REVEAL LEC 2026 KARMINE CORP",            "reveal"),
        ("Le NOUVEAU MAILLOT KC est ENFIN là",             "reveal"),
        ("BUNDLE 2026 : la collection est dispo !",        "reveal"),
        # 3. Reaction — REACT / réagit / watch party
        ("Kameto réagit aux highlights de KC vs G2",       "reaction"),
        ("ON RÉAGIT À NOTRE DÉFAITE EN FINALE",            "reaction"),
        ("WATCH PARTY KC vs FNATIC",                       "reaction"),
        # 4. Interview — interview / itw / press conf
        ("1ère interview de Caliste depuis sa MVP",        "interview"),
        ("INTERVIEW EXCLUSIVE : Yike avant les Worlds",    "interview"),
        ("Conférence de presse - LEC Spring Finals",       "interview"),
        # 5. Drama — drame / explique / raconte / déclaration
        ("Kameto EXPLIQUE TOUT sur le départ de Targamas", "drama"),
        ("Caliste RACONTE COMMENT il est arrivé chez KC",  "drama"),
        ("La DÉCLARATION choc de Reapered après la défaite", "drama"),
        # 6. Non-LoL — Valorant / Rocket League / Apex
        ("KARMINE CORP - VALORANT GAME CHANGERS 2026",     "irrelevant"),
        ("KCB ROCKET LEAGUE - RLCS WINTER OPEN",           "irrelevant"),
        ("Apex Legends ALGS - KC Highlights",              "irrelevant"),
        # 7. Highlights — short recap / best of
        ("TH vs. KC | HIGHLIGHTS | 2026 #LEC Spring - Week 3 Day 2", "highlight"),
        ("KC vs G2 - HIGHLIGHTS LEC Spring 2026",          "highlight"),
        ("BEST OF KC - Top 10 plays of Winter 2025",       "highlight"),
        # 8. Match — full game VOD (vs + Game/BO/tournament)
        ("KC vs. KOI | LEC | Game 2",                      "match"),
        ("KC vs FNC | LEC Spring 2026 - Game 1",           "match"),
        ("KC vs G2 BO5 Finale Spring 2026",                "match"),
        # 9. Irrelevant — empty + pure noise
        ("",                                               "irrelevant"),
        ("???",                                            "irrelevant"),
        ("Just a random podcast episode",                  "irrelevant"),
    ],
)
def test_classify_video_kind_real_world_titles(title, expected):
    from modules.channel_reconciler import _classify_video_kind
    assert _classify_video_kind(title) == expected, (
        f"title {title!r} should classify as {expected!r}"
    )


# ─── Parser tests : edge cases v4 added support for ──────────────────


def test_parse_lec_piped_game_n():
    """KC vs. KOI | LEC | Game 2 — captures team_a/team_b/game_n WITHOUT
    needing a Week/Day marker (v4 LEC_PIPED_GAME_RE added for this)."""
    from modules.channel_reconciler import parse_title_for_match
    out = parse_title_for_match("KC vs. KOI | LEC | Game 2", role=None)
    assert out is not None
    assert {out["team_a"], out["team_b"]} == {"KC", "KOI"}
    assert out["game_n"] == 2
    assert out["league"] == "lec"


def test_parse_valorant_title_returns_none_for_match_lookup():
    """A Valorant title mentions KC but is NOT a LoL match. The parser
    on its own may extract teams (it doesn't game-filter), so we rely
    on the classifier to short-circuit upstream. Sanity-check that the
    classifier rejects the title — if anyone removes the non-LoL guard,
    this test will fire."""
    from modules.channel_reconciler import _classify_video_kind
    title = "KARMINE CORP - VALORANT GAME CHANGERS 2026"
    # Even if parser would extract something, classifier must say
    # "irrelevant" so the reconciler bails before the parser ever runs.
    assert _classify_video_kind(title) == "irrelevant"


def test_parse_vague_kc_highlights_returns_none():
    """A title like "Karmine Corp Highlights" with no opponent is
    unparseable. The fuzzy fallback (separate code path) is the only
    way to rescue this."""
    from modules.channel_reconciler import parse_title_for_match
    out = parse_title_for_match("Karmine Corp Highlights", role=None)
    # No team_a/team_b extracted — should return None
    assert out is None or "team_a" not in out


# ─── Fuzzy fallback tests ────────────────────────────────────────────


@pytest.fixture
def fake_db():
    db = MagicMock(name="fake_db")
    db.base = "https://example.supabase.co/rest/v1"
    db.headers = {"apikey": "k", "Authorization": "Bearer k"}
    return db


def test_fuzzy_match_single_recent_kc_returns_external_id(monkeypatch, fake_db):
    """Vague "KC Highlights" + exactly 1 KC match in window → that match wins."""
    from modules import channel_reconciler as mod

    monkeypatch.setattr(
        mod, "_matches_in_window",
        lambda db, *, window_start, window_end: [
            {
                "id": "m-1",
                "external_id": "ext-kc-th-2026-04-10",
                "scheduled_at": "2026-04-10T18:00:00Z",
                "team_blue": {"code": "KC"},
                "team_red": {"code": "TH"},
            },
        ],
    )

    pivot = datetime(2026, 4, 12, 0, 0, tzinfo=timezone.utc)
    result = asyncio.run(
        mod._fuzzy_match_recent_kc(
            fake_db,
            "Karmine Corp Highlights of the week",
            published_at=pivot,
        ),
    )
    assert result == "ext-kc-th-2026-04-10"


def test_fuzzy_match_multiple_kc_matches_returns_none(monkeypatch, fake_db):
    """Two KC matches in the window → ambiguous → None (operator handles)."""
    from modules import channel_reconciler as mod

    monkeypatch.setattr(
        mod, "_matches_in_window",
        lambda db, *, window_start, window_end: [
            {
                "id": "m-1", "external_id": "ext-kc-th",
                "scheduled_at": "2026-04-10T18:00:00Z",
                "team_blue": {"code": "KC"}, "team_red": {"code": "TH"},
            },
            {
                "id": "m-2", "external_id": "ext-kc-koi",
                "scheduled_at": "2026-04-12T18:00:00Z",
                "team_blue": {"code": "KOI"}, "team_red": {"code": "KC"},
            },
        ],
    )

    pivot = datetime(2026, 4, 12, 0, 0, tzinfo=timezone.utc)
    result = asyncio.run(
        mod._fuzzy_match_recent_kc(
            fake_db, "KC Highlights", published_at=pivot,
        ),
    )
    assert result is None, "ambiguous (>1) must return None"


def test_fuzzy_match_no_kc_in_title_returns_none(monkeypatch, fake_db):
    """If the title doesn't even mention KC/Karmine, fuzzy must short-circuit
    without making a DB call."""
    from modules import channel_reconciler as mod

    called = {"n": 0}

    def fake_in_window(db, *, window_start, window_end):
        called["n"] += 1
        return []

    monkeypatch.setattr(mod, "_matches_in_window", fake_in_window)

    result = asyncio.run(
        mod._fuzzy_match_recent_kc(fake_db, "Random LEC podcast"),
    )
    assert result is None
    assert called["n"] == 0, "must NOT query DB when title doesn't mention KC"


# ─── reconcile_one : pre-filter routing ──────────────────────────────


def test_reconcile_one_vlog_marks_status_skipped_vlog(monkeypatch, fake_db):
    """A "Karmine Life #45" row gets status='skipped_vlog' BEFORE any parser
    or DB lookup. Operator log spam = killed."""
    from modules import channel_reconciler as mod

    captured: dict = {}

    def fake_safe_update(table, data, match_col, match_val):
        captured["table"] = table
        captured["data"] = data
        captured["match_col"] = match_col
        captured["match_val"] = match_val
        return True

    monkeypatch.setattr(mod, "safe_update", fake_safe_update)
    # The match-finder MUST NOT be called for a vlog.
    monkeypatch.setattr(
        mod, "find_match_candidates",
        lambda *a, **kw: pytest.fail("find_match_candidates called for vlog"),
    )

    video = {
        "id": "vid-vlog-1",
        "title": "Karmine Life #45 - On suit Caliste à la salle",
        "channel_role": "team_official",
        "channel_id": "ch-kameto-karmine",
    }
    new_status = asyncio.run(mod.reconcile_one(fake_db, video))

    assert new_status == "skipped_vlog"
    assert captured["table"] == "channel_videos"
    assert captured["data"]["status"] == "skipped_vlog"
    assert captured["data"]["video_type"] == "vlog"
    assert captured["data"]["content_type"] == "vlog"
    # Must have stamped matched_at so the row is idempotent on re-runs
    assert "matched_at" in captured["data"]
    # Sanity : the kind is exposed on the video dict for the run() aggregator
    assert video.get("_kind") == "vlog"


def test_reconcile_one_interview_marks_status_skipped_interview(
    monkeypatch, fake_db,
):
    from modules import channel_reconciler as mod

    captured: dict = {}

    def fake_safe_update(table, data, match_col, match_val):
        captured["data"] = data
        return True

    monkeypatch.setattr(mod, "safe_update", fake_safe_update)
    monkeypatch.setattr(
        mod, "find_match_candidates",
        lambda *a, **kw: pytest.fail("must not parse on interview"),
    )

    video = {
        "id": "vid-itw-1",
        "title": "1ère interview de Caliste depuis sa MVP",
        "channel_role": "team_official",
        "channel_id": "ch-kc",
    }
    new_status = asyncio.run(mod.reconcile_one(fake_db, video))

    assert new_status == "skipped_interview"
    assert captured["data"]["status"] == "skipped_interview"


def test_reconcile_one_match_title_does_not_short_circuit(monkeypatch, fake_db):
    """A real match title must NOT be skipped — it must reach the parser."""
    from modules import channel_reconciler as mod

    parser_calls: list[str] = []
    real_parser = mod.parse_title_for_match

    def spy_parser(title, role=None):
        parser_calls.append(title)
        return real_parser(title, role=role)

    monkeypatch.setattr(mod, "parse_title_for_match", spy_parser)

    # Stub the network-touching candidate lookup so the test is offline.
    async def fake_candidates(db, parsed, published_at):
        return [
            {
                "id": "m-1",
                "external_id": "ext-th-kc-2026",
                "scheduled_at": "2026-04-10T18:00:00Z",
                "team_blue": {"code": "KC"},
                "team_red": {"code": "TH"},
            },
        ]

    monkeypatch.setattr(mod, "find_match_candidates", fake_candidates)
    monkeypatch.setattr(mod, "safe_update", lambda *a, **kw: True)
    monkeypatch.setattr(mod, "safe_upsert", lambda *a, **kw: None)

    video = {
        "id": "vid-match-1",
        "title": "TH vs. KC | HIGHLIGHTS | 2026 #LEC Spring - Week 3 Day 2",
        "channel_role": "lec_highlights",
        "channel_id": "ch-lec",
        "published_at": "2026-04-11T09:00:00Z",
    }
    new_status = asyncio.run(mod.reconcile_one(fake_db, video))

    assert new_status == "matched"
    assert len(parser_calls) == 1, "parser MUST run on a real match title"
    # The pre-filter classified this as 'highlight' (it has HIGHLIGHTS tag)
    assert video.get("_kind") in {"match", "highlight"}


# ─── Sanity : SKIP/PARSE constants are coherent ──────────────────────


def test_skip_and_parse_kinds_disjoint():
    """V4 contract : SKIP_KINDS and PARSE_KINDS must NOT overlap, and
    'irrelevant' belongs to neither (it falls through to the v3 parser)."""
    from modules.channel_reconciler import SKIP_KINDS, PARSE_KINDS

    assert SKIP_KINDS.isdisjoint(PARSE_KINDS)
    # The 5 skip kinds
    assert SKIP_KINDS == frozenset({
        "vlog", "reveal", "reaction", "interview", "drama",
    })
    # The 2 parse kinds
    assert PARSE_KINDS == frozenset({"match", "highlight"})
    # 'irrelevant' is its own bucket
    assert "irrelevant" not in SKIP_KINDS
    assert "irrelevant" not in PARSE_KINDS


def test_v3_parser_still_works_on_legacy_lec_title():
    """V4 must NOT break v3's parser. The canonical LEC highlights format
    is the most-tested path — guard against regression."""
    from modules.channel_reconciler import parse_title_for_match

    out = parse_title_for_match(
        "TH vs. KC | HIGHLIGHTS | 2026 #LEC Spring - Week 3 Day 2",
        role="lec_highlights",
    )
    assert out is not None
    assert {out["team_a"], out["team_b"]} == {"TH", "KC"}
    assert out["league"] == "lec"
    assert out["week"] == 3
    assert out["day"] == 2
    assert out["content_type"] == "highlights"


# ─── Manual main runner ──────────────────────────────────────────────

if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v", "-s"]))
