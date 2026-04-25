"""
historical_team_id_resolver.py — map (team_slug, year) → gol.gg team_id.

Why this exists
---------------
gol.gg gives every team a NEW numeric id every year. Karmine Corp is :

    2021 → 1223       (LFL S1, original Yike-Cabochard roster)
    2022 → 1535       (LFL Rekkles era)
    2023 → 1881       (LFL final year)
    2024 → 2166       (LEC year 1)
    2025 → 2533       (LEC champions)
    2026 → 2899       (current)

You can't backfill a team historically without that mapping. We resolve
it dynamically by hitting gol.gg's "tournament-stats" page for each split
the team likely played, scraping the team table, and matching by alias.

Resolution strategy
-------------------
1. **Cache hit** : `worker/cache/golgg_team_ids.json` keyed by team_slug.
   Recompute only if --force.
2. **Static seed** : if `team_config.TrackedTeam.golgg_team_ids` exists
   (a `dict[int, int]` of {year: id}), use it as a seed (still cached).
3. **Discovery** : for each year, query gol.gg's tournament list pages
   for the team's known leagues, scrape the team-stats links, match by
   alias / display-name fuzzy compare.

The caller can also hard-code the mapping at construction time (useful
in tests : `resolver = HistoricalTeamIdResolver(seeds={"karmine-corp": {2024: 2166}})`).

This module does NOT scrape kills — it only resolves numeric IDs. Kept
separate from golgg_scraper.py so the scraper stays focused on parsing.

Usage
-----
    from services.historical_team_id_resolver import resolve_golgg_team_ids

    ids = resolve_golgg_team_ids("karmine-corp", (2021, 2026))
    # → {2021: 1223, 2022: 1535, 2023: 1881, 2024: 2166, 2025: 2533, 2026: 2899}

    # Or via the class for finer control :
    r = HistoricalTeamIdResolver()
    r.resolve("g2-esports", year_range=(2024, 2026), aliases=["G2", "G2 Esports"])
"""

from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

import structlog

log = structlog.get_logger()


# ── Cache file location (gitignored — see .gitignore) ─────────────────
_WORKER_ROOT = Path(__file__).resolve().parent.parent
_CACHE_DIR = _WORKER_ROOT / "cache"
_CACHE_FILE = _CACHE_DIR / "golgg_team_ids.json"


# ── Hard-coded seeds for known teams ──────────────────────────────────
# These were verified empirically during the KC backfill. The resolver
# will use them BEFORE attempting any HTTP discovery, so the test suite
# (and offline runs) work even without network access.
KNOWN_SEEDS: dict[str, dict[int, int]] = {
    "karmine-corp": {
        2021: 1223,
        2022: 1535,
        2023: 1881,
        2024: 2166,
        2025: 2533,
        2026: 2899,
    },
}


# ── Aliases : slug → list of names that gol.gg may use for this team ──
# When discovering via HTTP, we match the team-stats link's display name
# (or `title=` attr) against any of these. Case-insensitive.
KNOWN_ALIASES: dict[str, list[str]] = {
    "karmine-corp": ["Karmine Corp", "Karmine"],
    "g2-esports": ["G2 Esports", "G2"],
    "fnatic": ["Fnatic", "FNC"],
    "team-vitality": ["Team Vitality", "Vitality", "VIT"],
    "team-heretics": ["Team Heretics", "Heretics", "TH"],
    "mad-lions-koi": ["MAD Lions KOI", "MDK"],
    "rogue": ["Rogue", "RGE"],
    "sk-gaming": ["SK Gaming", "SK"],
    "excel-esports": ["Excel Esports", "XL", "Excel"],
    "team-bds": ["Team BDS", "BDS"],
    "giantx": ["GIANTX", "Giantx", "GX"],
    "movistar-riders": ["Movistar Riders", "MR"],
    "astralis": ["Astralis", "AST"],
}


@dataclass
class HistoricalTeamIdResolver:
    """Resolves the gol.gg team_id used for a given team in a given year.

    Persists results to disk so subsequent runs are free.

    Constructor params :
        seeds       Optional pre-known mapping
                    {team_slug: {year: golgg_id}}. Merged on top of
                    KNOWN_SEEDS, takes precedence (test injection).
        cache_path  Override the cache file location (tests use a tmp).
        http_get    Optional callable(url) → html, used for HTTP-based
                    discovery. Defaults to a `urllib.request.urlopen`
                    wrapper. Tests inject a mock so no network goes out.
    """

    seeds: dict[str, dict[int, int]] = field(default_factory=dict)
    cache_path: Path = field(default=_CACHE_FILE)
    http_get: Optional[callable] = None

    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _cache: dict[str, dict[str, int]] = field(default_factory=dict, repr=False)
    _cache_loaded: bool = field(default=False, repr=False)

    # ── Cache I/O ─────────────────────────────────────────────────────

    def _load_cache(self) -> None:
        """Load the on-disk cache once. Cache stores stringified years
        (JSON requires string keys). We rehydrate to int on read."""
        if self._cache_loaded:
            return
        with self._lock:
            if self._cache_loaded:
                return
            if self.cache_path.exists():
                try:
                    raw = json.loads(self.cache_path.read_text(encoding="utf-8"))
                    if isinstance(raw, dict):
                        self._cache = raw
                except Exception as e:
                    log.warn("golgg_id_cache_load_failed", error=str(e)[:120])
                    self._cache = {}
            self._cache_loaded = True

    def _save_cache(self) -> None:
        """Persist the cache to disk. Best-effort — failures don't crash
        the resolver, just emit a warning."""
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(
                json.dumps(self._cache, indent=2, sort_keys=True),
                encoding="utf-8",
            )
        except Exception as e:
            log.warn("golgg_id_cache_save_failed", error=str(e)[:120])

    def _cache_get(self, team_slug: str, year: int) -> Optional[int]:
        self._load_cache()
        bucket = self._cache.get(team_slug, {})
        v = bucket.get(str(year))
        return int(v) if v is not None else None

    def _cache_put(self, team_slug: str, year: int, golgg_id: int) -> None:
        self._load_cache()
        with self._lock:
            self._cache.setdefault(team_slug, {})[str(year)] = int(golgg_id)
        self._save_cache()

    # ── Seed merging ──────────────────────────────────────────────────

    def _seeded_id(self, team_slug: str, year: int) -> Optional[int]:
        """Return the seed id for (team, year), checking the constructor
        seeds first then KNOWN_SEEDS. None if not seeded."""
        # Constructor seeds win.
        for seed_map in (self.seeds, KNOWN_SEEDS):
            bucket = seed_map.get(team_slug)
            if bucket and year in bucket:
                return bucket[year]
        return None

    # ── Public API ────────────────────────────────────────────────────

    def resolve(
        self,
        team_slug: str,
        year_range: tuple[int, int],
        aliases: Optional[Iterable[str]] = None,
        force: bool = False,
    ) -> dict[int, int]:
        """Resolve the gol.gg team_id for every year in the inclusive range.

        Returns `{year: golgg_id}`. Years that can't be resolved are
        omitted (caller decides if that's an error or a no-op).

        Resolution order per year :
            1. constructor seeds  (test injection)
            2. KNOWN_SEEDS        (hard-coded for popular teams)
            3. on-disk cache      (previous successful HTTP discovery)
            4. HTTP discovery     (only if force=True or no cache hit)
        """
        y_lo, y_hi = sorted(year_range)
        out: dict[int, int] = {}

        for year in range(y_lo, y_hi + 1):
            # 1 + 2. Seeds.
            seed = self._seeded_id(team_slug, year)
            if seed is not None:
                out[year] = seed
                # Mirror seeds into the cache so a later force-refresh
                # against HTTP can be diffed.
                self._cache_put(team_slug, year, seed)
                continue

            # 3. On-disk cache.
            if not force:
                cached = self._cache_get(team_slug, year)
                if cached is not None:
                    out[year] = cached
                    continue

            # 4. HTTP discovery — last resort (and silent no-op if
            # http_get isn't wired up).
            discovered = self._discover_via_http(team_slug, year, list(aliases or []))
            if discovered is not None:
                self._cache_put(team_slug, year, discovered)
                out[year] = discovered

        return out

    # ── HTTP discovery ────────────────────────────────────────────────

    # gol.gg's tournament-stats page lists every team that played a split.
    # The link to a team's stats has the form :
    #     /teams/team-stats/<id>/...title='<Team Name> stats'
    # We scrape that and match by alias.
    _TEAM_LINK_RE = re.compile(
        r"team-stats/(\d+)/[^']+'\s*title='([^']+?)\s+stats'",
        re.IGNORECASE,
    )

    # Tournament URL templates — we try in order until one returns data.
    # The placeholder {year} is filled in. Trailing slash matters on gol.gg.
    _TOURNAMENT_URL_TEMPLATES: tuple[str, ...] = (
        # LEC modern era (2024+) uses "Spring Season" / "Summer Season" labels.
        "https://gol.gg/tournament/tournament-stats/LEC%20Spring%20Season%20{year}/",
        "https://gol.gg/tournament/tournament-stats/LEC%20{year}%20Spring%20Season/",
        "https://gol.gg/tournament/tournament-stats/LEC%20Summer%20Season%20{year}/",
        "https://gol.gg/tournament/tournament-stats/LEC%20{year}%20Summer%20Season/",
        # LFL pre-2024.
        "https://gol.gg/tournament/tournament-stats/LFL%20Spring%20{year}/",
        "https://gol.gg/tournament/tournament-stats/LFL%20Summer%20{year}/",
        # Worlds + MSI (international).
        "https://gol.gg/tournament/tournament-stats/Worlds%20{year}%20Main%20Event/",
        "https://gol.gg/tournament/tournament-stats/MSI%20{year}/",
    )

    def _http_get(self, url: str) -> Optional[str]:
        """Fetch a URL, return body or None on failure. Uses the injected
        http_get if provided ; otherwise falls back to urllib (with the
        same UA spoof that golgg_scraper.py uses)."""
        if self.http_get is not None:
            try:
                return self.http_get(url)
            except Exception as e:
                log.warn("golgg_id_resolver_http_failed", url=url[:80], error=str(e)[:120])
                return None
        # Default urllib path — only reached if the caller didn't inject a
        # mock. We import lazily so tests that never trigger HTTP don't
        # need to monkey-patch urllib.
        try:
            import gzip
            import urllib.request
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/130.0.0.0 Safari/537.36"
                    ),
                    "Accept-Encoding": "gzip",
                    "Accept": "text/html,application/xhtml+xml",
                },
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return raw.decode("utf-8", errors="ignore")
        except Exception as e:
            log.warn("golgg_id_resolver_urllib_failed", url=url[:80], error=str(e)[:120])
            return None

    def _discover_via_http(
        self,
        team_slug: str,
        year: int,
        extra_aliases: list[str],
    ) -> Optional[int]:
        """Walk the tournament URL templates, scrape teams, return the
        first match by alias. Returns None if discovery fails — the
        caller treats that as "couldn't resolve, skip year"."""
        # Build the alias list. Caller's aliases > KNOWN_ALIASES > slug
        # itself (case-insensitive normalise of slug).
        aliases: list[str] = []
        aliases.extend(extra_aliases)
        aliases.extend(KNOWN_ALIASES.get(team_slug, []))
        # Slug fallback : "karmine-corp" → "karmine corp"
        aliases.append(team_slug.replace("-", " "))

        # Lowercase set for matching.
        alias_lc = {a.strip().lower() for a in aliases if a and a.strip()}

        for template in self._TOURNAMENT_URL_TEMPLATES:
            url = template.format(year=year)
            html = self._http_get(url)
            if not html:
                continue
            for m in self._TEAM_LINK_RE.finditer(html):
                tid_str = m.group(1)
                title = m.group(2).strip()
                if title.lower() in alias_lc:
                    try:
                        tid = int(tid_str)
                    except ValueError:
                        continue
                    log.info(
                        "golgg_id_resolved",
                        team_slug=team_slug,
                        year=year,
                        golgg_team_id=tid,
                        source_url=url[:80],
                    )
                    return tid
        log.info("golgg_id_unresolved", team_slug=team_slug, year=year)
        return None


# ── Module-level convenience ──────────────────────────────────────────

_default_resolver: Optional[HistoricalTeamIdResolver] = None


def _get_default() -> HistoricalTeamIdResolver:
    global _default_resolver
    if _default_resolver is None:
        _default_resolver = HistoricalTeamIdResolver()
    return _default_resolver


def resolve_golgg_team_ids(
    team_slug: str,
    year_range: tuple[int, int],
    aliases: Optional[Iterable[str]] = None,
    force: bool = False,
) -> dict[int, int]:
    """Convenience function : resolve one team's mapping using the
    default resolver instance (cache + KNOWN_SEEDS).

    Returns `{year: golgg_team_id}` for every year that resolved.
    """
    return _get_default().resolve(team_slug, year_range, aliases=aliases, force=force)


__all__ = [
    "HistoricalTeamIdResolver",
    "resolve_golgg_team_ids",
    "KNOWN_SEEDS",
    "KNOWN_ALIASES",
]
