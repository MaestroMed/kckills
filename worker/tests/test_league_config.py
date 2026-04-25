"""Tests for services.league_config + services.league_id_lookup.

Covers the multi-league sentinel contract introduced by PR-loltok BB :

  * KCKILLS_TRACKED_LEAGUES env var resolution :
      - unset / empty       → ['lec']  (byte-identical to KC pilot)
      - 'lec'               → just LEC
      - 'lec,lcs,lck'       → 3 leagues
      - '*'                 → every active league in `leagues` table
  * Cache freezes after first resolution (matches runtime_tuning policy).
  * Unknown slugs are dropped, NOT raised, and logged for ops.
  * Empty DB → fallback to LEC built from static lookup (never crash).
  * TrackedLeague sort order = priority asc, then slug.
  * league_id_lookup static map covers all the SEEDS in seed_leagues.
  * get_league_lolesports_id falls through to the static lookup when
    a league isn't yet in the DB.

The DB layer is mocked at the supabase_client boundary so these
tests run cleanly in unit-test CI (no Supabase, no network).
"""

from __future__ import annotations

import importlib
import os
import sys

import pytest

# Add worker root to path so `services.*` imports resolve.
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


# ─── Helpers ──────────────────────────────────────────────────────
def _reload(monkeypatch: pytest.MonkeyPatch, env_value: str | None = None):
    """Reimport services.league_config + reset its + lookup's caches.

    Sets/unsets KCKILLS_TRACKED_LEAGUES per the env_value arg before
    reloading. Returns (league_config_module, lookup_module).
    """
    if env_value is None:
        monkeypatch.delenv("KCKILLS_TRACKED_LEAGUES", raising=False)
    else:
        monkeypatch.setenv("KCKILLS_TRACKED_LEAGUES", env_value)

    for mod_name in ("services.league_config", "services.league_id_lookup"):
        if mod_name in sys.modules:
            importlib.reload(sys.modules[mod_name])

    import services.league_config as lc
    import services.league_id_lookup as ll
    lc.reset_cache()
    ll.reset_cache()
    return lc, ll


def _stub_db_select(monkeypatch: pytest.MonkeyPatch, rows: list[dict]):
    """Stub services.supabase_client.safe_select to return the given rows.

    Also stubs `get_db()` so the wildcard branch (which calls
    db.select directly) finds a non-None client.
    """
    import services.supabase_client as sc

    monkeypatch.setattr(
        sc,
        "safe_select",
        lambda table, columns="*", **filters: [
            r for r in rows if all(r.get(k) == v for k, v in filters.items())
        ],
    )

    class _FakeDB:
        def select(self, table, columns="*", filters=None):
            f = filters or {}
            return [r for r in rows if all(r.get(k) == v for k, v in f.items())]

    monkeypatch.setattr(sc, "get_db", lambda: _FakeDB())


# Sample rows mimicking the seed table — three leagues active, one
# inactive so we can verify the wildcard filter.
_SAMPLE_ROWS = [
    {
        "slug": "lec",
        "name": "LoL EMEA Championship",
        "short_name": "LEC",
        "region": "EMEA",
        "lolesports_league_id": "98767991302996019",
        "priority": 10,
        "active": True,
    },
    {
        "slug": "lcs",
        "name": "League Championship Series",
        "short_name": "LCS",
        "region": "Americas",
        "lolesports_league_id": "98767991299243165",
        "priority": 20,
        "active": True,
    },
    {
        "slug": "lck",
        "name": "LoL Champions Korea",
        "short_name": "LCK",
        "region": "Korea",
        "lolesports_league_id": "98767991310872058",
        "priority": 30,
        "active": True,
    },
    {
        "slug": "ebl",
        "name": "Elite Series",
        "short_name": "EBL",
        "region": "EMEA",
        "lolesports_league_id": "107407335299756365",
        "priority": 140,
        "active": False,    # inactive — wildcard should skip
    },
]


# ─── 1. Default mode: env unset → just LEC ────────────────────────
def test_default_env_unset_returns_lec_only(monkeypatch: pytest.MonkeyPatch):
    """KCKILLS_TRACKED_LEAGUES unset → exactly one TrackedLeague (LEC).

    This is the byte-identical-to-pilot contract.
    """
    _stub_db_select(monkeypatch, _SAMPLE_ROWS)
    lc, _ = _reload(monkeypatch, env_value=None)
    out = lc.load_tracked_leagues()
    assert len(out) == 1
    assert out[0].slug == "lec"
    assert out[0].lolesports_league_id == "98767991302996019"


def test_default_env_empty_string_returns_lec_only(monkeypatch: pytest.MonkeyPatch):
    """Whitespace-only env behaves like unset."""
    _stub_db_select(monkeypatch, _SAMPLE_ROWS)
    lc, _ = _reload(monkeypatch, env_value="   ")
    out = lc.load_tracked_leagues()
    assert [t.slug for t in out] == ["lec"]


# ─── 2. Multi-league mode: CSV ────────────────────────────────────
def test_csv_three_leagues(monkeypatch: pytest.MonkeyPatch):
    """KCKILLS_TRACKED_LEAGUES=lec,lcs,lck → 3 TrackedLeagues."""
    _stub_db_select(monkeypatch, _SAMPLE_ROWS)
    lc, _ = _reload(monkeypatch, env_value="lec,lcs,lck")
    out = lc.load_tracked_leagues()
    assert {t.slug for t in out} == {"lec", "lcs", "lck"}
    # And they're sorted by priority — LEC (10) first.
    assert [t.slug for t in out] == ["lec", "lcs", "lck"]


def test_csv_with_extra_whitespace_and_case(monkeypatch: pytest.MonkeyPatch):
    """' LEC , LCS ' → handled (trim + lowercase)."""
    _stub_db_select(monkeypatch, _SAMPLE_ROWS)
    lc, _ = _reload(monkeypatch, env_value=" LEC , LCS ")
    out = lc.load_tracked_leagues()
    assert {t.slug for t in out} == {"lec", "lcs"}


# ─── 3. Wildcard mode: every active league ────────────────────────
def test_wildcard_returns_only_active(monkeypatch: pytest.MonkeyPatch):
    """KCKILLS_TRACKED_LEAGUES=* → 3 active rows, NOT the inactive ebl."""
    _stub_db_select(monkeypatch, _SAMPLE_ROWS)
    lc, _ = _reload(monkeypatch, env_value="*")
    out = lc.load_tracked_leagues()
    slugs = [t.slug for t in out]
    assert "ebl" not in slugs   # inactive
    assert {"lec", "lcs", "lck"}.issubset(set(slugs))


# ─── 4. Unknown slug handling ─────────────────────────────────────
def test_unknown_slug_dropped_silently(monkeypatch: pytest.MonkeyPatch):
    """A typo'd slug → dropped from the result, NOT raised."""
    _stub_db_select(monkeypatch, _SAMPLE_ROWS)
    lc, _ = _reload(monkeypatch, env_value="lec,not_a_real_league")
    out = lc.load_tracked_leagues()
    assert [t.slug for t in out] == ["lec"]


def test_all_unknown_slugs_falls_back_to_lec(monkeypatch: pytest.MonkeyPatch):
    """Every requested slug missing → safety fallback to LEC.

    Guarantees the pilot keeps producing kills even if the operator
    misconfigures the env var.
    """
    _stub_db_select(monkeypatch, [])  # empty DB
    lc, _ = _reload(monkeypatch, env_value="not_real,also_not_real")
    out = lc.load_tracked_leagues()
    assert len(out) == 1
    assert out[0].slug == "lec"
    # The fallback uses the static league_id_lookup, so the id is set.
    assert out[0].lolesports_league_id == "98767991302996019"


# ─── 5. Sort order (priority asc) ─────────────────────────────────
def test_sort_order_by_priority_then_slug(monkeypatch: pytest.MonkeyPatch):
    """Result list is sorted by (priority, slug) — LEC always first."""
    _stub_db_select(monkeypatch, _SAMPLE_ROWS)
    lc, _ = _reload(monkeypatch, env_value="lck,lcs,lec")  # input order shuffled
    out = lc.load_tracked_leagues()
    # priority 10 < 20 < 30
    assert [t.priority for t in out] == [10, 20, 30]
    assert [t.slug for t in out] == ["lec", "lcs", "lck"]


# ─── 6. Cache contract (resolve once, freeze) ─────────────────────
def test_cache_freezes_after_first_call(monkeypatch: pytest.MonkeyPatch):
    """Second call returns the cached list — env mutations don't take."""
    _stub_db_select(monkeypatch, _SAMPLE_ROWS)
    lc, _ = _reload(monkeypatch, env_value="lec")
    first = lc.load_tracked_leagues()
    # Mutate the env post-resolution — should NOT show up.
    monkeypatch.setenv("KCKILLS_TRACKED_LEAGUES", "lec,lcs")
    second = lc.load_tracked_leagues()
    assert [t.slug for t in second] == [t.slug for t in first] == ["lec"]


def test_force_reload_picks_up_env_change(monkeypatch: pytest.MonkeyPatch):
    """force_reload=True bypasses the cache (test-only contract)."""
    _stub_db_select(monkeypatch, _SAMPLE_ROWS)
    lc, _ = _reload(monkeypatch, env_value="lec")
    assert [t.slug for t in lc.load_tracked_leagues()] == ["lec"]
    monkeypatch.setenv("KCKILLS_TRACKED_LEAGUES", "lec,lcs")
    out = lc.load_tracked_leagues(force_reload=True)
    assert [t.slug for t in out] == ["lec", "lcs"]


# ─── 7. Convenience accessors ─────────────────────────────────────
def test_get_league_by_slug(monkeypatch: pytest.MonkeyPatch):
    """get_league_by_slug returns the matching TrackedLeague or None."""
    _stub_db_select(monkeypatch, _SAMPLE_ROWS)
    lc, _ = _reload(monkeypatch, env_value="lec,lcs")
    assert lc.get_league_by_slug("lec").short_name == "LEC"
    assert lc.get_league_by_slug("LEC").short_name == "LEC"  # case-insensitive
    assert lc.get_league_by_slug("not_tracked") is None
    assert lc.get_league_by_slug("") is None


def test_get_league_lolesports_id_via_dataclass(monkeypatch: pytest.MonkeyPatch):
    """When the league IS tracked, return its DB id."""
    _stub_db_select(monkeypatch, _SAMPLE_ROWS)
    lc, _ = _reload(monkeypatch, env_value="lec,lcs")
    assert lc.get_league_lolesports_id("lec") == "98767991302996019"
    assert lc.get_league_lolesports_id("lcs") == "98767991299243165"


def test_get_league_lolesports_id_falls_through_to_lookup(monkeypatch: pytest.MonkeyPatch):
    """When NOT tracked, fall through to the static lookup map.

    The seed script always populates the static map first, so even
    pre-seed a caller can resolve any of the 13 known leagues.
    """
    _stub_db_select(monkeypatch, _SAMPLE_ROWS)
    lc, _ = _reload(monkeypatch, env_value="lec")
    # 'lpl' isn't in the tracked list, but is in the static lookup.
    assert lc.get_league_lolesports_id("lpl") == "98767991314006698"


# ─── 8. league_id_lookup static map ───────────────────────────────
def test_lookup_static_map_covers_all_seeds(monkeypatch: pytest.MonkeyPatch):
    """Every slug in seed_leagues.SEEDS must have a static fallback id.

    Guarantees the script can populate the leagues table even when
    getLeagues is unreachable.
    """
    _, ll = _reload(monkeypatch, env_value=None)
    # Import the seed list lazily so we don't import the script unless
    # this assertion needs it.
    from scripts import seed_leagues
    for seed in seed_leagues.SEEDS:
        slug = seed["slug"]
        assert ll.slug_to_lolesports_id(slug) is not None, (
            f"slug={slug} missing from _FALLBACK_IDS — add it to "
            f"services/league_id_lookup.py"
        )


def test_lookup_reverse_mapping(monkeypatch: pytest.MonkeyPatch):
    """lolesports_id_to_slug is the inverse of slug_to_lolesports_id."""
    _, ll = _reload(monkeypatch, env_value=None)
    lid = ll.slug_to_lolesports_id("lec")
    assert lid == "98767991302996019"
    assert ll.lolesports_id_to_slug(lid) == "lec"
    # Unknown id → None, not crash.
    assert ll.lolesports_id_to_slug("0000000000000") is None
    assert ll.lolesports_id_to_slug("") is None


def test_lookup_case_insensitive_and_trimmed(monkeypatch: pytest.MonkeyPatch):
    """Slugs are normalised (lower + strip) before lookup."""
    _, ll = _reload(monkeypatch, env_value=None)
    assert ll.slug_to_lolesports_id("  LEC  ") == ll.slug_to_lolesports_id("lec")
    assert ll.slug_to_lolesports_id("") is None
    assert ll.slug_to_lolesports_id("   ") is None
