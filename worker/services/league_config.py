"""
LEAGUE_CONFIG — runtime resolution of "which leagues should we ingest?".

The KCKills pilot follows the LEC. The LoLTok rewrite must scale to
every Riot pro circuit. This module is the single point where the
worker decides which leagues to scan on a given cycle.

Contract :
    KCKILLS_TRACKED_LEAGUES env var, comma-separated slugs.
        - Unset / empty           → ["lec"] (byte-identical to today)
        - "lec"                   → just LEC
        - "lec,lcs,lck"           → 3 leagues
        - "*"                     → every row in `leagues` with active=true

Slugs not present in the `leagues` table are silently dropped and
logged as `league_config_unknown_slug` (never raises). If NONE of the
requested slugs match anything in the DB, we fall back to LEC so the
pilot keeps producing kills no matter what's in the env.

Returned items are TrackedLeague dataclasses sorted by `priority`
ascending — the sentinel loops over them in that order, so high-
priority leagues (LEC = 10) are polled first.

Resolution is cached for the lifetime of the process. Operators must
restart the worker to change the tracked-league list, mirroring the
existing runtime_tuning contract ("restart to tune").
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from typing import Optional

import structlog

from services import league_id_lookup

log = structlog.get_logger()


# ─── Constants ────────────────────────────────────────────────────
ENV_VAR = "KCKILLS_TRACKED_LEAGUES"
DEFAULT_SLUG = "lec"          # KC pilot home league
WILDCARD = "*"                 # "all active leagues" sentinel value


# ─── Dataclass returned to callers ────────────────────────────────
@dataclass(frozen=True)
class TrackedLeague:
    """A league the worker is configured to ingest.

    `lolesports_league_id` is what the API client passes as the
    `leagueId` query param. May be None for leagues that exist on
    Leaguepedia / gol.gg but never on lolesports — the sentinel
    skips those (Agent BD's scraper handles them via a different
    code path).
    """
    slug: str
    name: str
    short_name: str
    region: str
    lolesports_league_id: Optional[str]
    priority: int

    def __str__(self) -> str:  # nice log lines
        return f"{self.short_name}({self.slug})"


# ─── Cache ────────────────────────────────────────────────────────
_cache_lock = threading.Lock()
_cached: Optional[list[TrackedLeague]] = None


def _parse_env(raw: str | None) -> list[str]:
    """Parse KCKILLS_TRACKED_LEAGUES into a list of slugs.

    Returns ['lec'] when unset/empty so the pilot keeps working.
    Returns ['*'] for the wildcard ; the caller resolves it.
    """
    if not raw:
        return [DEFAULT_SLUG]
    cleaned = raw.strip()
    if not cleaned:
        return [DEFAULT_SLUG]
    if cleaned == WILDCARD:
        return [WILDCARD]
    parts = [s.strip().lower() for s in cleaned.split(",") if s.strip()]
    return parts or [DEFAULT_SLUG]


def _row_to_tracked(row: dict) -> Optional[TrackedLeague]:
    """Convert a leagues row dict → TrackedLeague, dropping the row
    on missing required fields."""
    slug = (row.get("slug") or "").strip().lower()
    if not slug:
        return None
    return TrackedLeague(
        slug=slug,
        name=row.get("name") or slug.upper(),
        short_name=row.get("short_name") or slug.upper(),
        region=row.get("region") or "?",
        lolesports_league_id=(
            (row.get("lolesports_league_id") or "").strip() or None
        ),
        priority=int(row.get("priority") or 100),
    )


def _select_rows(slugs: list[str]) -> list[dict]:
    """Pull the matching rows from the leagues table.

    Wildcard ('*') → all active rows.
    Otherwise → rows whose slug is in the list (active or not, so
    operators can force-enable an inactive league via env).
    """
    try:
        from services.supabase_client import safe_select, get_db
    except Exception:
        return []

    db = get_db()
    if not db:
        return []

    if slugs == [WILDCARD]:
        try:
            return db.select("leagues", filters={"active": True}) or []
        except Exception as e:
            log.warn("league_config_select_failed", error=str(e)[:120])
            return []

    # Per-slug select. PostgREST supports `slug=in.(a,b,c)` but we go
    # one-at-a-time via safe_select to keep the transient-error
    # tolerance the rest of the worker relies on.
    rows: list[dict] = []
    for slug in slugs:
        if slug == WILDCARD:
            continue  # mixed wildcard + slugs → wildcard wins via separate code path
        chunk = safe_select(
            "leagues",
            "*",
            slug=slug,
        )
        rows.extend(chunk or [])
    return rows


def _build_fallback() -> list[TrackedLeague]:
    """Last-resort fallback when nothing comes back from the DB.

    Builds a single-entry LEC TrackedLeague from the static lookup
    so the pilot keeps producing kills even on a fresh DB.
    """
    lid = league_id_lookup.slug_to_lolesports_id(DEFAULT_SLUG)
    return [TrackedLeague(
        slug=DEFAULT_SLUG,
        name="LoL EMEA Championship",
        short_name="LEC",
        region="EMEA",
        lolesports_league_id=lid,
        priority=10,
    )]


def load_tracked_leagues(force_reload: bool = False) -> list[TrackedLeague]:
    """Return the leagues this worker should ingest, sorted by priority.

    Cached for the process lifetime ; pass `force_reload=True` from
    tests / interactive shells to re-read the env + DB.
    """
    global _cached
    if _cached is not None and not force_reload:
        return _cached

    with _cache_lock:
        if _cached is not None and not force_reload:
            return _cached

        requested = _parse_env(os.environ.get(ENV_VAR))
        rows = _select_rows(requested)

        tracked: list[TrackedLeague] = []
        seen: set[str] = set()
        for row in rows:
            tl = _row_to_tracked(row)
            if tl is None or tl.slug in seen:
                continue
            tracked.append(tl)
            seen.add(tl.slug)

        # Surface unknown slugs (operator typo, league not seeded yet)
        if requested != [WILDCARD]:
            for slug in requested:
                if slug not in seen:
                    log.warn(
                        "league_config_unknown_slug",
                        slug=slug,
                        hint="run worker/scripts/seed_leagues.py",
                    )

        if not tracked:
            log.warn(
                "league_config_empty_fallback_lec",
                requested=requested,
            )
            tracked = _build_fallback()

        tracked.sort(key=lambda t: (t.priority, t.slug))
        _cached = tracked
        log.info(
            "league_config_loaded",
            count=len(tracked),
            slugs=[t.slug for t in tracked],
            requested=requested,
        )
        return _cached


def get_league_by_slug(slug: str) -> Optional[TrackedLeague]:
    """Return one TrackedLeague by slug, or None if not tracked.

    Convenience for callers that already have a slug from a different
    code path (e.g. the channel reconciler tagging a video).
    """
    if not slug:
        return None
    target = slug.strip().lower()
    for tl in load_tracked_leagues():
        if tl.slug == target:
            return tl
    return None


def get_league_lolesports_id(slug: str) -> Optional[str]:
    """Return the numeric leagueId for a tracked league slug.

    Falls through to league_id_lookup so we work even before the
    DB is seeded.
    """
    tl = get_league_by_slug(slug)
    if tl and tl.lolesports_league_id:
        return tl.lolesports_league_id
    return league_id_lookup.slug_to_lolesports_id(slug)


def reset_cache() -> None:
    """Test-only — clear the cached league list."""
    global _cached
    with _cache_lock:
        _cached = None


__all__ = [
    "TrackedLeague",
    "ENV_VAR",
    "DEFAULT_SLUG",
    "WILDCARD",
    "load_tracked_leagues",
    "get_league_by_slug",
    "get_league_lolesports_id",
    "reset_cache",
]
