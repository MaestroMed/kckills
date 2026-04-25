"""
TEAM_CONFIG — Single source of truth for tracked teams (LoLTok foundation).

Why this module exists
──────────────────────
The kckills.com pilot was hardcoded around Karmine Corp : the worker had
"KC" string literals scattered across modules, the DB schema even called
the involvement column `tracked_team_involvement` (correct) but the
game_events column kept the `kc_involvement` legacy name. As we transition
to LoLTok ("the TikTok of LoL — every league, every team, every kill"),
we need a clean indirection so the SAME worker codebase can be configured
to track 1, 5, or 200 teams without code changes.

This module is feature-flagged:
  * KCKILLS_TRACKED_TEAMS not set         → tracks ["karmine-corp"] only
                                            (= byte-identical to current
                                            pilot behaviour, EtoStark demo
                                            keeps working)
  * KCKILLS_TRACKED_TEAMS="t1,gen-g,fnatic" → tracks those 3 teams
  * KCKILLS_TRACKED_TEAMS="*"             → tracks every team in
                                            worker/config/teams.json
                                            (= LoLTok mode)

The catalog itself lives in worker/config/teams.json (JSON not YAML —
no PyYAML dep). Add a team there, no Python changes needed.

Usage
─────
    from services.team_config import (
        load_tracked_teams, get_team_by_slug, get_team_by_alias,
        is_tracked, primary_team,
    )

    # All currently-tracked teams (filtered by env var).
    teams = load_tracked_teams()

    # Lookup by canonical slug.
    kc = get_team_by_slug("karmine-corp")

    # Lookup by ANY alias (case-insensitive). Used by channel_reconciler
    # to expand "KCORP" / "KARMINE" / "KC" all into the same TrackedTeam.
    same_kc = get_team_by_alias("KCORP")

    # Quick boolean — used in publish gates and discord routing.
    if is_tracked("karmine-corp"): ...

    # The "primary" tracked team (= first one in TRACKED env, or
    # KCKILLS_PRIMARY_TEAM_SLUG if set). Used by KC-centric legacy
    # routes (/kc, the homepage hero, the Discord bot's default channel)
    # that haven't been refactored yet.
    pt = primary_team()

Caching
───────
load_tracked_teams() caches the catalog in module state on first call.
Restart the worker to pick up edits to teams.json or env changes. This
matches the rest of the worker (services/runtime_tuning.py is the same).
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from typing import Optional

# ─── Public dataclass ────────────────────────────────────────────────────


@dataclass(frozen=True)
class TrackedTeam:
    """Immutable team record. One per active team in the LoLTok catalog.

    Frozen so consumers can stash references without worrying about
    accidental mutation (and so we can hash by slug if a set is needed).

    Attributes
    ──────────
    slug
        URL-safe canonical id, e.g. "karmine-corp". The /team/[slug]
        web route uses this. Stable across renames of the team.
    code
        2-4 letter shortcode used by Riot's broadcast graphics + most
        community sites (gol.gg, leaguepedia). e.g. "KC", "T1".
    name
        Pretty display name, e.g. "Karmine Corp", "Team SoloMid".
    aliases
        List of OTHER strings this team is known by (case-insensitive
        comparison applied at lookup time). Includes the code and any
        misspellings or shorthand we've seen in YouTube titles. The
        canonical `code` is also automatically considered an alias.
    lolesports_team_id
        Riot's internal team id from esports-api.lolesports.com getTeams.
        Null = pending lookup (Agent BB will backfill).
    golgg_team_id
        gol.gg's numeric team id. KC has multiple across years (see
        worker/scripts/backfill_golgg.py for the year-by-year mapping
        copied into golgg_team_ids_history).
    golgg_team_ids_history
        Year-by-year gol.gg team ids when a single canonical id doesn't
        exist (KC LFL S1 is 1223, LFL S2 is 1535, etc.). Maps a
        league_year key to the int.
    leaguepedia_name
        Cargo API team-page name (with spaces and casing). Null = pending.
    active
        Set False to disable a team without deleting its entry. The team
        stays referenceable for historical kills but is hidden from new
        feeds. We default to True for any team in the catalog.
    league
        Primary league the team currently competes in (lec / lcs / lck /
        lpl / lfl / etc.). Used by Agent BB's league-aware sentinel.
    """

    slug: str
    code: str
    name: str
    aliases: list[str] = field(default_factory=list)
    lolesports_team_id: Optional[str] = None
    golgg_team_id: Optional[int] = None
    golgg_team_ids_history: dict[str, int] = field(default_factory=dict)
    leaguepedia_name: Optional[str] = None
    active: bool = True
    league: Optional[str] = None

    def __hash__(self) -> int:  # type: ignore[override]
        # frozen=True gives a default __hash__, but we need a stable one
        # that survives mutable list/dict fields → hash by slug only.
        return hash(self.slug)


# ─── Module state (cached) ───────────────────────────────────────────────

_DEFAULT_PRIMARY_SLUG = "karmine-corp"
_TEAMS_JSON_PATH = Path(__file__).parent.parent / "config" / "teams.json"

_LOCK = Lock()
_CACHED_CATALOG: Optional[list[TrackedTeam]] = None    # full catalog (every team)
_CACHED_TRACKED: Optional[list[TrackedTeam]] = None    # filtered by env var
_CACHED_BY_SLUG: dict[str, TrackedTeam] = {}
_CACHED_BY_ALIAS: dict[str, TrackedTeam] = {}


# ─── Internal helpers ────────────────────────────────────────────────────


def _load_catalog_from_disk() -> list[TrackedTeam]:
    """Read teams.json. Returns empty list if the file is missing.

    The empty-list fallback matters in unit tests where the worker is
    imported on a machine without the config dir checked out — we
    don't want a brittle ImportError. Production deploys always ship
    the file.
    """
    if not _TEAMS_JSON_PATH.exists():
        return []
    try:
        raw = json.loads(_TEAMS_JSON_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        # Logging here would create a circular import (structlog → config).
        # Swallowing is safe — load_tracked_teams() returns [] and the
        # caller falls back to its hardcoded default ("karmine-corp").
        return []

    teams_raw = raw.get("teams") or []
    out: list[TrackedTeam] = []
    for t in teams_raw:
        slug = (t.get("slug") or "").strip()
        if not slug:
            continue
        out.append(
            TrackedTeam(
                slug=slug,
                code=(t.get("code") or "").strip(),
                name=(t.get("name") or "").strip(),
                aliases=list(t.get("aliases") or []),
                lolesports_team_id=t.get("lolesports_team_id") or None,
                golgg_team_id=t.get("golgg_team_id") or None,
                golgg_team_ids_history=dict(t.get("golgg_team_ids_history") or {}),
                leaguepedia_name=t.get("leaguepedia_name") or None,
                active=bool(t.get("active", True)),
                league=t.get("league") or None,
            )
        )
    return out


def _parse_env_slugs() -> list[str]:
    """Comma-separated list from KCKILLS_TRACKED_TEAMS, or default."""
    raw = (os.getenv("KCKILLS_TRACKED_TEAMS", "") or "").strip()
    if not raw:
        return [_DEFAULT_PRIMARY_SLUG]
    if raw == "*":
        return ["*"]
    return [s.strip() for s in raw.split(",") if s.strip()]


def _build_lookup_indexes(tracked: list[TrackedTeam]) -> None:
    """Rebuild the slug + alias lookup tables. Called from inside _LOCK."""
    global _CACHED_BY_SLUG, _CACHED_BY_ALIAS
    _CACHED_BY_SLUG = {t.slug: t for t in tracked}
    by_alias: dict[str, TrackedTeam] = {}
    for t in tracked:
        # Auto-include code + name as aliases. Aliases are upper-cased
        # for case-insensitive lookup.
        keys: set[str] = set()
        if t.code:
            keys.add(t.code.upper())
        if t.name:
            keys.add(t.name.upper())
        for a in t.aliases:
            if a:
                keys.add(a.strip().upper())
        for key in keys:
            # First write wins on collision — KC's "KC" beats VITB's "BEE"
            # because we iterate in catalog order. Document if a real
            # collision shows up in production.
            by_alias.setdefault(key, t)
    _CACHED_BY_ALIAS = by_alias


# ─── Public API ──────────────────────────────────────────────────────────


def load_tracked_teams(*, force_reload: bool = False) -> list[TrackedTeam]:
    """Return the list of teams CURRENTLY tracked by this worker instance.

    Result is cached in module state on first call. Pass force_reload=True
    in tests when env vars or the JSON file have changed mid-run.

    Filtering rules :
      * KCKILLS_TRACKED_TEAMS unset  → return ONLY [karmine-corp]
                                       (drops the rest of the catalog
                                        from the in-memory tracked set).
      * KCKILLS_TRACKED_TEAMS="*"    → return every team in teams.json
                                       (LoLTok mode — Agent BB uses
                                        this for the league-wide sentinel).
      * Otherwise comma-list         → return matching teams in env-list
                                       order, silently dropping unknown
                                       slugs.
    """
    global _CACHED_CATALOG, _CACHED_TRACKED
    with _LOCK:
        if force_reload or _CACHED_CATALOG is None:
            _CACHED_CATALOG = _load_catalog_from_disk()
            _CACHED_TRACKED = None  # invalidate

        if _CACHED_TRACKED is not None and not force_reload:
            return _CACHED_TRACKED

        env_slugs = _parse_env_slugs()
        catalog = _CACHED_CATALOG

        if env_slugs == ["*"]:
            tracked = list(catalog)
        else:
            slug_to_team = {t.slug: t for t in catalog}
            tracked = []
            for slug in env_slugs:
                team = slug_to_team.get(slug)
                if team is not None:
                    tracked.append(team)

            # Safety net : if the env var pointed only at unknown slugs
            # (typo, deleted entry, etc.), don't silently track NOTHING
            # — fall back to the default. This preserves byte-identical
            # behaviour in misconfigured deploys.
            if not tracked:
                fallback = slug_to_team.get(_DEFAULT_PRIMARY_SLUG)
                if fallback is not None:
                    tracked = [fallback]

        _CACHED_TRACKED = tracked
        _build_lookup_indexes(tracked)
        return tracked


def get_team_by_slug(slug: str) -> Optional[TrackedTeam]:
    """Return the TrackedTeam with this slug, or None.

    Only searches the CURRENTLY-TRACKED set, not the full catalog. This
    is intentional : a worker tracking only KC shouldn't act on a T1 row.
    """
    if not slug:
        return None
    load_tracked_teams()  # ensures index is populated
    return _CACHED_BY_SLUG.get(slug)


def get_team_by_alias(alias: str) -> Optional[TrackedTeam]:
    """Lookup a team by ANY of its aliases (case-insensitive).

    Includes the canonical code and the display name as implicit aliases
    so callers don't need to know which is which. Returns None if nothing
    matches in the currently-tracked set.

    Used by channel_reconciler to map YouTube title fragments like
    "KARMINE", "KCORP", "KC" all to the same TrackedTeam.
    """
    if not alias:
        return None
    load_tracked_teams()  # ensures index is populated
    return _CACHED_BY_ALIAS.get(alias.strip().upper())


def is_tracked(slug: str) -> bool:
    """True if `slug` is in the currently-tracked set. Quick boolean
    used by publish gates, discord routing, and analytics filters.
    """
    return get_team_by_slug(slug) is not None


def primary_team() -> Optional[TrackedTeam]:
    """The "default" team for legacy KC-centric code paths (homepage
    hero, /kc redirect, Discord channel default). Resolution order :
      1. KCKILLS_PRIMARY_TEAM_SLUG env var, if set
      2. First entry in KCKILLS_TRACKED_TEAMS, if set
      3. Hardcoded "karmine-corp" fallback

    Returns None only if EVERY lookup misses (catalog empty, env
    pointed at nothing → would also be a fallback miss).
    """
    explicit = (os.getenv("KCKILLS_PRIMARY_TEAM_SLUG", "") or "").strip()
    if explicit:
        return get_team_by_slug(explicit)
    tracked = load_tracked_teams()
    if tracked:
        return tracked[0]
    return get_team_by_slug(_DEFAULT_PRIMARY_SLUG)


def all_aliases() -> dict[str, str]:
    """Return {ALIAS_UPPER: canonical_code} for every tracked team.

    Used by channel_reconciler.normalise_team to replace its hardcoded
    TEAM_ALIAS dict. The key is case-normalised (upper), the value is
    the team's canonical short code (KC, T1, FNC...).
    """
    load_tracked_teams()
    return {alias: team.code for alias, team in _CACHED_BY_ALIAS.items() if team.code}


def reset_cache() -> None:
    """Test helper — clears the module cache so the next load_tracked_teams
    call re-reads env + disk. Production code never calls this."""
    global _CACHED_CATALOG, _CACHED_TRACKED, _CACHED_BY_SLUG, _CACHED_BY_ALIAS
    with _LOCK:
        _CACHED_CATALOG = None
        _CACHED_TRACKED = None
        _CACHED_BY_SLUG = {}
        _CACHED_BY_ALIAS = {}
