"""Tests for services/team_config.py — the LoLTok tracked-teams indirection.

Spec recap (from PR-loltok BA prompt) :
  * KCKILLS_TRACKED_TEAMS unset                 → tracks ["karmine-corp"]
                                                  (byte-identical to pilot)
  * KCKILLS_TRACKED_TEAMS="karmine-corp,t1,gen-g" → tracks 3 teams
  * KCKILLS_TRACKED_TEAMS="*"                   → tracks every team in
                                                  worker/config/teams.json

We need at least 8 tests covering :
  1. Default mode (env unset) returns only Karmine Corp
  2. Multi-team env returns the requested teams in order
  3. "*" mode returns the full catalog (>= 50 entries)
  4. get_team_by_slug returns the right team / None for unknown
  5. get_team_by_alias is case-insensitive AND honours every alias
  6. is_tracked is a clean boolean
  7. primary_team prefers KCKILLS_PRIMARY_TEAM_SLUG > first tracked > "karmine-corp"
  8. Unknown env slug falls back to default (no silent empty tracked set)
  9. all_aliases returns {ALIAS_UPPER: code} mapping
  10. reset_cache + force_reload behave as expected for hot-reload
  11. Catalog seed includes the major teams (KC, G2, T1, JDG…) in expected
      leagues (smoke test that prevents regressions in teams.json edits)

Strategy
────────
We monkey-patch os.environ via pytest's `monkeypatch` and call
team_config.reset_cache() between scenarios so the module-level cache
doesn't leak across tests.
"""

from __future__ import annotations

import os
import sys

import pytest

# Add worker root to sys.path before importing.
_WORKER_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _WORKER_ROOT)

# Stub Supabase env so config.py side-effects don't blow up when
# imported transitively. (team_config itself doesn't import config,
# but pytest collection sometimes imports siblings.)
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")

from services import team_config  # noqa: E402


# ─── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clean_cache():
    """Reset the module cache before AND after every test. The team_config
    module memoises the tracked list — if test A sets env var X and test
    B doesn't reset, test B sees A's environment.
    """
    team_config.reset_cache()
    yield
    team_config.reset_cache()


# ─── Test 1 — Default behaviour (KC only) ────────────────────────────────


def test_default_tracks_only_karmine_corp(monkeypatch):
    monkeypatch.delenv("KCKILLS_TRACKED_TEAMS", raising=False)
    monkeypatch.delenv("KCKILLS_PRIMARY_TEAM_SLUG", raising=False)

    teams = team_config.load_tracked_teams()
    assert len(teams) == 1, f"expected 1 team in default mode, got {len(teams)}"
    assert teams[0].slug == "karmine-corp"
    assert teams[0].code == "KC"
    assert teams[0].name == "Karmine Corp"
    assert teams[0].active is True


# ─── Test 2 — Multi-team env ─────────────────────────────────────────────


def test_multi_team_env(monkeypatch):
    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "karmine-corp,t1,gen-g")
    teams = team_config.load_tracked_teams()
    slugs = [t.slug for t in teams]
    assert slugs == ["karmine-corp", "t1", "gen-g"]


def test_multi_team_env_handles_whitespace(monkeypatch):
    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "  karmine-corp ,  fnatic  ")
    slugs = [t.slug for t in team_config.load_tracked_teams()]
    assert slugs == ["karmine-corp", "fnatic"]


# ─── Test 3 — Wildcard "*" loads full catalog ────────────────────────────


def test_wildcard_loads_full_catalog(monkeypatch):
    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "*")
    teams = team_config.load_tracked_teams()
    # The seed has ~50 teams. We assert >= 40 to allow for catalog edits
    # that prune dead teams without breaking the test on every PR.
    assert len(teams) >= 40, f"expected wildcard to load full catalog (>=40), got {len(teams)}"
    slugs = {t.slug for t in teams}
    # Spot-check expected entries from each major league exist
    assert "karmine-corp" in slugs
    assert "g2-esports" in slugs
    assert "t1" in slugs
    assert "jd-gaming" in slugs
    assert "vitality-bee" in slugs


# ─── Test 4 — Slug lookup ────────────────────────────────────────────────


def test_get_team_by_slug(monkeypatch):
    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "*")
    kc = team_config.get_team_by_slug("karmine-corp")
    assert kc is not None
    assert kc.code == "KC"

    t1 = team_config.get_team_by_slug("t1")
    assert t1 is not None
    assert t1.name == "T1"

    missing = team_config.get_team_by_slug("does-not-exist")
    assert missing is None

    empty = team_config.get_team_by_slug("")
    assert empty is None


def test_get_team_by_slug_respects_tracked_filter(monkeypatch):
    """Only tracking KC → looking up T1 by slug returns None even though
    T1 exists in the full catalog. This is intentional : the worker
    shouldn't act on rows for teams it isn't tracking."""
    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "karmine-corp")
    assert team_config.get_team_by_slug("karmine-corp") is not None
    assert team_config.get_team_by_slug("t1") is None


# ─── Test 5 — Alias lookup is case-insensitive ───────────────────────────


def test_get_team_by_alias_case_insensitive(monkeypatch):
    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "*")

    # All the variants reconciler used to hardcode
    for alias in ("KC", "kc", "Kc", "KCORP", "kcorp", "KARMINE", "karmine corp"):
        team = team_config.get_team_by_alias(alias)
        assert team is not None, f"alias {alias!r} should resolve"
        assert team.slug == "karmine-corp", f"alias {alias!r} resolved to {team.slug}"


def test_get_team_by_alias_full_alias_set(monkeypatch):
    """Confirm code + name + every declared alias all resolve."""
    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "*")

    g2 = team_config.get_team_by_alias("G2")
    assert g2 is not None and g2.slug == "g2-esports"

    g2_long = team_config.get_team_by_alias("G2ESPORTS")
    assert g2_long is not None and g2_long.slug == "g2-esports"

    t1_by_skt = team_config.get_team_by_alias("SKT")
    assert t1_by_skt is not None and t1_by_skt.slug == "t1"

    assert team_config.get_team_by_alias("UNKNOWN_TEAM") is None
    assert team_config.get_team_by_alias("") is None


# ─── Test 6 — is_tracked boolean ─────────────────────────────────────────


def test_is_tracked_default(monkeypatch):
    monkeypatch.delenv("KCKILLS_TRACKED_TEAMS", raising=False)
    assert team_config.is_tracked("karmine-corp") is True
    assert team_config.is_tracked("t1") is False  # not in default tracked set
    assert team_config.is_tracked("") is False


def test_is_tracked_multi(monkeypatch):
    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "t1,gen-g")
    assert team_config.is_tracked("t1") is True
    assert team_config.is_tracked("gen-g") is True
    assert team_config.is_tracked("karmine-corp") is False


# ─── Test 7 — primary_team resolution chain ──────────────────────────────


def test_primary_team_default(monkeypatch):
    monkeypatch.delenv("KCKILLS_TRACKED_TEAMS", raising=False)
    monkeypatch.delenv("KCKILLS_PRIMARY_TEAM_SLUG", raising=False)
    p = team_config.primary_team()
    assert p is not None
    assert p.slug == "karmine-corp"


def test_primary_team_explicit_env_wins(monkeypatch):
    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "karmine-corp,t1")
    monkeypatch.setenv("KCKILLS_PRIMARY_TEAM_SLUG", "t1")
    p = team_config.primary_team()
    assert p is not None and p.slug == "t1"


def test_primary_team_falls_back_to_first_tracked(monkeypatch):
    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "fnatic,t1")
    monkeypatch.delenv("KCKILLS_PRIMARY_TEAM_SLUG", raising=False)
    p = team_config.primary_team()
    assert p is not None and p.slug == "fnatic"


# ─── Test 8 — Unknown env slug → safety fallback ─────────────────────────


def test_unknown_env_slug_falls_back_to_default(monkeypatch):
    """A typo in KCKILLS_TRACKED_TEAMS shouldn't make the worker track
    NOTHING — that would silently break the production pipeline. We
    fall back to the hardcoded default."""
    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "totally-fake-team-xyz")
    teams = team_config.load_tracked_teams()
    assert len(teams) == 1
    assert teams[0].slug == "karmine-corp"


# ─── Test 9 — all_aliases reverse map ────────────────────────────────────


def test_all_aliases_returns_uppercase_keys(monkeypatch):
    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "karmine-corp,t1")
    aliases = team_config.all_aliases()
    # KC's code should be present
    assert aliases.get("KC") == "KC"
    # And T1's
    assert aliases.get("T1") == "T1"
    # SKT should map to T1 (alias)
    assert aliases.get("SKT") == "T1"
    # No lowercase keys
    assert all(k == k.upper() for k in aliases.keys())


# ─── Test 10 — reset_cache + force_reload ────────────────────────────────


def test_force_reload_picks_up_env_change(monkeypatch):
    monkeypatch.delenv("KCKILLS_TRACKED_TEAMS", raising=False)
    teams_before = team_config.load_tracked_teams()
    assert len(teams_before) == 1

    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "karmine-corp,t1,fnatic")
    # Without force_reload, cache is stale
    teams_stale = team_config.load_tracked_teams()
    assert len(teams_stale) == 1  # cached

    teams_fresh = team_config.load_tracked_teams(force_reload=True)
    assert len(teams_fresh) == 3


# ─── Test 11 — Catalog smoke test (prevents broken teams.json) ───────────


def test_catalog_seed_has_major_teams(monkeypatch):
    """Smoke test : the seed catalog must include the major LEC + LCS +
    LCK + LPL + LFL teams. If someone deletes Karmine Corp from the JSON,
    this test screams immediately."""
    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "*")
    teams = team_config.load_tracked_teams()
    slugs = {t.slug for t in teams}

    # LEC
    assert "karmine-corp" in slugs
    assert "g2-esports" in slugs
    assert "fnatic" in slugs
    # LCS
    assert "cloud9" in slugs
    assert "team-liquid" in slugs
    # LCK
    assert "t1" in slugs
    assert "gen-g" in slugs
    # LPL
    assert "jd-gaming" in slugs
    # LFL
    assert "karmine-corp-blue" in slugs
    assert "vitality-bee" in slugs


def test_kc_has_golgg_history(monkeypatch):
    """KC's gol.gg team_id is multi-year (1223 LFL21, 1535 LFL22, 1881
    LFL23, 2166 LEC24, 2533 LEC25, 2899 LEC26). The history must be
    preserved in the catalog so the gol.gg backfill script keeps working.
    """
    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "karmine-corp")
    kc = team_config.get_team_by_slug("karmine-corp")
    assert kc is not None
    history = kc.golgg_team_ids_history
    # Every key from the original backfill_golgg.py must be present
    expected_years = {"lfl_2021", "lfl_2022", "lfl_2023", "lec_2024", "lec_2025", "lec_2026"}
    assert expected_years.issubset(set(history.keys()))
    # And the headline ID matches the LEC 2026 entry (current default)
    assert kc.golgg_team_id == 2899


# ─── Test 12 — TrackedTeam dataclass behaviour ───────────────────────────


def test_tracked_team_is_hashable(monkeypatch):
    """TrackedTeam needs to be hashable so callers can stash it in a set
    keyed by slug (e.g. for de-duping across multiple lookups in the
    sentinel)."""
    monkeypatch.setenv("KCKILLS_TRACKED_TEAMS", "*")
    a = team_config.get_team_by_slug("karmine-corp")
    b = team_config.get_team_by_slug("karmine-corp")
    s = {a, b}  # would raise TypeError if unhashable
    assert len(s) == 1
