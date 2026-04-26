"""
LEAGUE_ID_LOOKUP — slug ↔ lolesports numeric id mapping.

A small, hot-path-friendly module that maps short league slugs (the
canonical keys we use in env vars + DB) to the numeric `leagueId`
parameter that esports-api.lolesports.com expects.

Why a separate module rather than reading the `leagues` table on every
call ?
  * Sentinel + backfills resolve a slug → id on EVERY scheduling tick.
    A round-trip to Supabase per call adds avoidable latency.
  * The mapping is essentially static — Riot has not renamed a league
    id since 2019. We only need to refresh when a brand-new league
    launches, in which case the operator runs `seed_leagues.py`.
  * The fallback static table here means the sentinel can boot and
    work in OFFLINE / fresh-DB scenarios (e.g. dev machine with empty
    `leagues` table) without crashing.

Resolution order :
  1. In-memory cache populated lazily from the `leagues` table. We
     read it on first call ; subsequent calls are O(1) dict lookups.
  2. The static `_FALLBACK_IDS` table below — kept manually in sync
     with the catalog by way of the seed script. This is what the
     unit tests exercise (no DB needed).
  3. None — the caller is responsible for bailing out gracefully.

The module is deliberately pure-functions + a single mutable dict ;
it never raises on lookup failure.
"""

from __future__ import annotations

import threading
from typing import Optional

import structlog

log = structlog.get_logger()


# ─── Static fallback (used when the leagues table is empty) ───────
#
# Source : esports-api.lolesports.com getLeagues, snapshot taken
# 2026-04-25. Riot has historically not renamed these — but the seed
# script DOES re-fetch them on every run, so the canonical source is
# the `leagues` table. This dict only kicks in when (a) the DB hasn't
# been seeded yet, or (b) we're running unit tests with no DB.
_FALLBACK_IDS: dict[str, str] = {
    "lec":           "98767991302996019",
    "lcs":           "98767991299243165",
    "lck":           "98767991310872058",
    "lpl":           "98767991314006698",
    "lfl":           "105266103462388553",
    "lcl":           "108001239847565215",  # League Champions League (CIS)
    "lco":           "105266088231142133",  # LoL Circuit Oceania
    "nlc":           "105266074488398661",  # Northern League of Legends Championship
    "ebl":           "107407335299756365",  # Elite Series Belgium / Ultraliga
    "emea_masters":  "100695891328981122",
    "worlds":        "98767975604431411",
    "msi":           "98767991325878492",
    "first_stand":   "113377174962508955",
}


# ─── Mutable in-process cache ────────────────────────────────────
_cache_lock = threading.Lock()
_id_by_slug: dict[str, str] = {}
_slug_by_id: dict[str, str] = {}
_loaded = False


def _ensure_loaded() -> None:
    """Lazily populate the cache from the leagues table.

    On any failure (Supabase down, table missing, no rows) we fall
    back to the static map ; the lookup keeps working.
    """
    global _loaded
    if _loaded:
        return
    with _cache_lock:
        if _loaded:
            return  # double-check after lock
        _id_by_slug.clear()
        _slug_by_id.clear()
        # 1. Seed with the static fallback so we always have *something*.
        for slug, lid in _FALLBACK_IDS.items():
            _id_by_slug[slug] = lid
            _slug_by_id[lid] = slug
        # 2. Overlay the DB rows when reachable. NEVER raise.
        try:
            from services.supabase_client import safe_select
            rows = safe_select(
                "leagues",
                "slug,lolesports_league_id",
            )
            for row in rows or []:
                slug = (row.get("slug") or "").strip().lower()
                lid = (row.get("lolesports_league_id") or "").strip()
                if slug and lid:
                    _id_by_slug[slug] = lid
                    _slug_by_id[lid] = slug
            log.info(
                "league_id_lookup_loaded",
                from_db=len(rows or []),
                total=len(_id_by_slug),
            )
        except Exception as e:
            # Pure fallback path — log once, keep the static map alive.
            log.warn("league_id_lookup_fallback", error=str(e)[:120])
        _loaded = True


def slug_to_lolesports_id(slug: str) -> Optional[str]:
    """Return the numeric leagueId for a slug, or None if unknown.

    Case-insensitive on the slug. Trims surrounding whitespace.
    """
    if not slug:
        return None
    _ensure_loaded()
    return _id_by_slug.get(slug.strip().lower())


def lolesports_id_to_slug(lolesports_id: str) -> Optional[str]:
    """Reverse mapping for log lines / dashboard humanisation."""
    if not lolesports_id:
        return None
    _ensure_loaded()
    return _slug_by_id.get(str(lolesports_id).strip())


def all_known_slugs() -> list[str]:
    """Snapshot of the slugs the lookup currently knows about.

    Used by tests + the seed script's verification step.
    """
    _ensure_loaded()
    return sorted(_id_by_slug.keys())


def reset_cache() -> None:
    """Force the next lookup to re-read the leagues table.

    Test-only ; production code never calls this.
    """
    global _loaded
    with _cache_lock:
        _id_by_slug.clear()
        _slug_by_id.clear()
        _loaded = False


__all__ = [
    "slug_to_lolesports_id",
    "lolesports_id_to_slug",
    "all_known_slugs",
    "reset_cache",
]
