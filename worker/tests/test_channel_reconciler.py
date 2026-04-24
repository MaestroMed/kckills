"""Tests for modules/channel_reconciler.py v3 (Wave 2 rewrite).

Coverage
--------
The reconciler v3 fixes three real-world bugs PR25 surfaced. We cover each:

  * (A) Status filter widening — RECONCILE_STATUSES is now {discovered,
        classified, manual_review} (was just classified).
  * (B) GIANTX alias normalisation — "GX" → "GIANTX" so video titles
        using either form land on the same team_id. Previous bug was the
        mapping being inverted (DB stored "GIANTX" but alias forced "GX").
  * (C) published_at preservation — earlier discoverer pass dropped the
        field via --extract-flat=True. The reconciler now uses it for
        the ±7d window.

Plus the parser is covered against real-world LEC / LFL / EUM titles to
guarantee the regex bank doesn't regress.

Strategy
--------
The parser (`parse_title_for_match`) and helper (`normalise_team`,
`_pick_closest`) are pure — tested directly. `find_match_candidates`
is async + reads from PostgREST so we monkey-patch `_matches_in_window`
to inject deterministic candidates.
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


# ─── Title parser tests (real-world fixtures) ────────────────────────


def test_parse_lec_th_vs_kc_highlights():
    """Real LEC title: TH vs KC with HIGHLIGHTS tag and Week/Day."""
    from modules.channel_reconciler import parse_title_for_match

    title = "TH vs. KC | HIGHLIGHTS | 2026 #LEC Spring - Week 3 Day 2"
    out = parse_title_for_match(title, role="lec_highlights")

    assert out is not None, "title must parse"
    assert out["league"] == "lec"
    # Set comparison — order-insensitive
    assert {out["team_a"], out["team_b"]} == {"TH", "KC"}
    assert out["week"] == 3
    assert out["day"] == 2
    assert out["content_type"] == "highlights"


def test_parse_lec_with_game_n_tag():
    """A 'Game N' marker should populate game_n."""
    from modules.channel_reconciler import parse_title_for_match
    title = "G2 vs KC Game 2 | LEC Spring 2026"
    out = parse_title_for_match(title, role="lec_highlights")
    assert out is not None
    assert out.get("game_n") == 2


def test_parse_no_kc_in_generic_pattern_returns_none():
    """Generic 'TEAMA vs TEAMB' with NEITHER side being KC should be
    rejected — we don't pull garbage matches that don't involve KC."""
    from modules.channel_reconciler import parse_title_for_match
    title = "G2 vs FNC - Random match"
    # This title doesn't carry any tournament tag, so only GENERIC_VS_RE
    # could match — and that requires KC on at least one side.
    out = parse_title_for_match(title, role=None)
    assert out is None, "generic vs match without KC must NOT parse"


def test_parse_unparseable_title_returns_none():
    """Pure noise → None."""
    from modules.channel_reconciler import parse_title_for_match
    assert parse_title_for_match("", None) is None
    assert parse_title_for_match("Just a podcast about LoL", None) is None


# ─── GIANTX alias bug (Wave 2 fix) ───────────────────────────────────


def test_giantx_alias_normalises_gx_to_giantx():
    """The previous v2 bug was the alias mapping was inverted (DB had
    GIANTX but alias mapped to GX). v3 fixes by inverting: any GiantX-ish
    code normalises to canonical 'GIANTX' (matches teams.code in DB).
    """
    from modules.channel_reconciler import normalise_team

    # Both forms must land on GIANTX
    assert normalise_team("GX") == "GIANTX"
    assert normalise_team("GIANTX") == "GIANTX"
    # And the team-of-origin assertion: GIANTX wins over GIA in the sense
    # that the canonical form persists. (There's no separate "GIA" alias
    # in the codebase — anything not in TEAM_ALIAS passes through; "GIA"
    # would just stay "GIA". The Wave 2 fix was specifically inverting
    # GX -> GIANTX so that all variants land on the canonical code.)
    # Verify that the reverse — normalise GIANTX into GX — does NOT happen.
    result = normalise_team("GIANTX")
    assert result != "GX", (
        "previous bug: TEAM_ALIAS was inverted, mapping GIANTX -> GX. "
        "v3 must keep GIANTX as the canonical form."
    )


def test_giantx_in_lec_title_normalises_correctly():
    """End-to-end: a LEC title with GX team code parses to GIANTX."""
    from modules.channel_reconciler import parse_title_for_match
    title = "GX vs KC | HIGHLIGHTS | LEC Spring 2026"
    out = parse_title_for_match(title, role="lec_highlights")
    assert out is not None
    assert {out["team_a"], out["team_b"]} == {"GIANTX", "KC"}


# ─── normalise_team general behaviour ────────────────────────────────


def test_normalise_team_strips_dots_and_case():
    """Case + dots/spaces/dashes are flattened, then alias lookup."""
    from modules.channel_reconciler import normalise_team
    assert normalise_team("kc") == "KC"
    assert normalise_team("K.C.") == "KC"
    assert normalise_team("Karmine") == "KC"
    assert normalise_team("KARMINE CORP") == "KC"


def test_normalise_team_passthrough_for_unknown():
    """Codes without an alias come back uppercased + cleaned."""
    from modules.channel_reconciler import normalise_team
    assert normalise_team("FNC") == "FNC"
    assert normalise_team("g2") == "G2"
    assert normalise_team("") == ""


# ─── Reconcile statuses widened (Wave 2 fix A) ───────────────────────


def test_reconcile_statuses_includes_all_three():
    """v3 widened the candidate-row set. Must accept discovered,
    classified, AND manual_review — the previous v2 only looked at
    classified rows so 154 manual_review videos were stuck."""
    from modules.channel_reconciler import RECONCILE_STATUSES
    assert set(RECONCILE_STATUSES) == {
        "discovered", "classified", "manual_review",
    }


# ─── find_match_candidates: published_at + team-set logic ────────────


@pytest.fixture
def fake_db():
    db = MagicMock(name="fake_db")
    db.base = "https://example.supabase.co/rest/v1"
    db.headers = {"apikey": "k", "Authorization": "Bearer k"}
    return db


def test_find_match_candidates_team_set_match(monkeypatch, fake_db):
    """Set comparison on (TH, KC) — a match with team_blue=KC, team_red=TH
    must be returned regardless of order."""
    from modules import channel_reconciler as mod

    candidates_pool = [
        {
            "id": "m-1",
            "external_id": "ext-th-kc",
            "scheduled_at": "2026-04-01T18:00:00Z",
            "team_blue": {"code": "KC"},
            "team_red": {"code": "TH"},
        },
        # Decoy that doesn't include KC
        {
            "id": "m-2",
            "external_id": "ext-decoy",
            "scheduled_at": "2026-04-01T18:00:00Z",
            "team_blue": {"code": "G2"},
            "team_red": {"code": "TH"},
        },
    ]
    monkeypatch.setattr(
        mod, "_matches_in_window",
        lambda db, *, window_start, window_end: candidates_pool,
    )

    parsed = {"team_a": "TH", "team_b": "KC", "year": 2026}
    pivot = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)
    result = asyncio.run(mod.find_match_candidates(fake_db, parsed, pivot))

    assert len(result) == 1
    assert result[0]["external_id"] == "ext-th-kc"


def test_find_match_candidates_published_at_window_used(monkeypatch, fake_db):
    """When published_at is provided, ±7d window must be passed to the
    matches query (Wave 2 fix B — was 30d default)."""
    from modules import channel_reconciler as mod

    captured: dict = {}

    def fake_in_window(db, *, window_start, window_end):
        captured["window_start"] = window_start
        captured["window_end"] = window_end
        return []

    monkeypatch.setattr(mod, "_matches_in_window", fake_in_window)

    pivot = datetime(2026, 4, 10, 12, 0, tzinfo=timezone.utc)
    parsed = {"team_a": "TH", "team_b": "KC"}
    asyncio.run(mod.find_match_candidates(fake_db, parsed, pivot))

    # ±7d
    assert captured["window_start"] == "2026-04-03T12:00:00+00:00"
    assert captured["window_end"] == "2026-04-17T12:00:00+00:00"


def test_find_match_candidates_no_kc_returns_empty(monkeypatch, fake_db):
    """If parsed teams don't include KC/KCB, we never query — short-circuit."""
    from modules import channel_reconciler as mod

    called = {"n": 0}

    def fake_in_window(db, *, window_start, window_end):
        called["n"] += 1
        return []

    monkeypatch.setattr(mod, "_matches_in_window", fake_in_window)

    parsed = {"team_a": "G2", "team_b": "FNC"}
    result = asyncio.run(
        mod.find_match_candidates(fake_db, parsed, published_at=None),
    )
    assert result == []
    assert called["n"] == 0, "must not query DB when KC isn't in the parsed teams"


def test_find_match_candidates_year_only_uses_full_year_window(
    monkeypatch, fake_db,
):
    """When only `year` is in parsed (no published_at), the window must
    span the entire year — fallback for old uploads with no date."""
    from modules import channel_reconciler as mod

    captured: dict = {}

    def fake_in_window(db, *, window_start, window_end):
        captured["window_start"] = window_start
        captured["window_end"] = window_end
        return []

    monkeypatch.setattr(mod, "_matches_in_window", fake_in_window)

    parsed = {"team_a": "TH", "team_b": "KC", "year": 2025}
    asyncio.run(
        mod.find_match_candidates(fake_db, parsed, published_at=None),
    )
    assert captured["window_start"].startswith("2025-01-01")
    assert captured["window_end"].startswith("2025-12-31")


# ─── _pick_closest tie-breaking ──────────────────────────────────────


def test_pick_closest_returns_nearest_to_pivot():
    """Among multiple candidates, the one closest to the pivot wins."""
    from modules.channel_reconciler import _pick_closest

    candidates = [
        {"id": "early", "scheduled_at": "2026-03-15T18:00:00Z"},
        {"id": "near",  "scheduled_at": "2026-04-10T18:00:00Z"},
        {"id": "late",  "scheduled_at": "2026-05-15T18:00:00Z"},
    ]
    pivot = datetime(2026, 4, 11, 12, 0, tzinfo=timezone.utc)
    result = _pick_closest(candidates, pivot)
    assert result["id"] == "near"


def test_pick_closest_no_pivot_returns_first():
    """No pivot → returns the first (caller already DESC-sorted)."""
    from modules.channel_reconciler import _pick_closest
    candidates = [
        {"id": "first", "scheduled_at": "2026-04-10T18:00:00Z"},
        {"id": "second", "scheduled_at": "2026-04-05T18:00:00Z"},
    ]
    result = _pick_closest(candidates, None)
    assert result["id"] == "first"


def test_pick_closest_empty_returns_none():
    """No candidates → None."""
    from modules.channel_reconciler import _pick_closest
    assert _pick_closest([], None) is None


# ─── Manual main runner ──────────────────────────────────────────────

if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v", "-s"]))
