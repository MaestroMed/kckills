"""
backfill_league.py — Backfill every team in a league for a given year.

Wraps backfill_team.process_year() in a simple async-fan-out so we can
import a whole league (LEC, LFL, LCS, LCK, LPL, ...) in one command.

Source of truth for the team list :
  1. league_config.get_league_by_slug(slug)  — when BB ships it
  2. The teams table in Supabase, filtered by league             (fallback)
  3. A bare CLI flag --teams a,b,c                                (manual)

Concurrency : team-level fan-out capped at 3 in-flight at any time. The
gol.gg per-request rate limiter is per-GolggClient instance, so two
parallel team backfills DO double up. We keep --concurrency low to be
nice (and to reduce 429s).

CLI
---
  python -m worker.scripts.backfill_league --league lec
  python -m worker.scripts.backfill_league --league lec --year 2024
  python -m worker.scripts.backfill_league --league lec --limit-teams 5
  python -m worker.scripts.backfill_league --league lec --teams karmine-corp,g2-esports
  python -m worker.scripts.backfill_league --league lec --concurrency 2
  python -m worker.scripts.backfill_league --league lec --dry-run

Args mirror backfill_team where they make sense.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import structlog

# ── Path bootstrapping ────────────────────────────────────────────────
_HERE = Path(__file__).resolve()
_WORKER_ROOT = _HERE.parent.parent
_REPO_ROOT = _WORKER_ROOT.parent
if str(_WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(_WORKER_ROOT))
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(_WORKER_ROOT / ".env")
except Exception:
    pass

log = structlog.get_logger()


# ── League / team list resolution ─────────────────────────────────────

def _get_league_by_slug(slug: str) -> Optional[dict]:
    """Return the league config (services.league_config owns it). Falls
    back to a bare {slug, name} dict if league_config isn't built yet."""
    try:
        from services import league_config  # type: ignore[attr-defined]
        getter = getattr(league_config, "get_league_by_slug", None)
        if getter is None:
            raise ImportError
        league = getter(slug)
        if league is None:
            # Even if the league isn't in the seeded catalog, return a
            # bare dict so --teams overrides still work.
            return {"slug": slug, "name": slug.upper()}
        if isinstance(league, dict):
            return league
        # TrackedLeague dataclass shape (services.league_config).
        out: dict = {
            "slug": getattr(league, "slug", slug),
            "name": getattr(league, "name", slug.upper()),
        }
        for attr in ("short_name", "region", "lolesports_league_id",
                     "priority", "code", "default_year_range",
                     "team_slugs"):
            v = getattr(league, attr, None)
            if v is not None:
                out[attr] = v
        return out
    except ImportError:
        return {"slug": slug, "name": slug.upper(), "team_slugs": []}


def _team_slugs_for_league(
    league: dict,
    explicit: Optional[list[str]],
) -> list[str]:
    """Resolve which team slugs to backfill.

    Order of precedence :
        1. --teams a,b,c              (CLI override)
        2. league.team_slugs          (when league_config supplies it)
        3. team_config catalog filter (TrackedTeam.league == slug)
        4. teams table query          (Supabase fallback by region)
    """
    if explicit:
        return [s.strip() for s in explicit if s.strip()]

    pre = league.get("team_slugs")
    if pre:
        return list(pre)

    # 3. team_config catalog scan : every TrackedTeam whose `league`
    #    matches our slug. This works regardless of env-tracked subset
    #    because we want the FULL league, not just the subset the
    #    sentinel polls.
    try:
        from services import team_config
        # Use the unfiltered catalog if available, else the tracked set.
        all_teams = getattr(team_config, "load_full_catalog", None)
        if all_teams is None:
            all_teams = getattr(team_config, "load_tracked_teams")
        rows = all_teams() or []
        match = [t.slug for t in rows
                 if getattr(t, "league", None) == league["slug"]]
        if match:
            return match
    except Exception as e:
        log.warn("team_config_catalog_scan_failed", error=str(e)[:120])

    # 4. Supabase fallback by region.
    try:
        from services.supabase_client import safe_select
        code = (league.get("code") or league["slug"]).upper()
        rows = safe_select("teams", "slug,region")
        return [r["slug"] for r in rows
                if r.get("slug") and (r.get("region") or "").upper() == code]
    except Exception as e:
        log.warn("team_lookup_via_supabase_failed", error=str(e)[:120])
        return []


# ── Per-team processing — delegate to backfill_team ───────────────────

# Import path that works for both `python -m worker.scripts...` and
# `python worker/scripts/...`. The backfill_team script is sibling.
def _import_backfill_team():
    try:
        from worker.scripts.backfill_team import (
            _get_team_by_slug, process_year, BackfillReport, YearReport,
        )
    except ImportError:
        from scripts.backfill_team import (  # type: ignore[no-redef]
            _get_team_by_slug, process_year, BackfillReport, YearReport,
        )
    return _get_team_by_slug, process_year, BackfillReport, YearReport


@dataclass
class TeamSummary:
    team_slug: str
    kills_inserted: int = 0
    games_added: int = 0
    matches_added: int = 0
    errors: list[str] = field(default_factory=list)


@dataclass
class LeagueReport:
    league_slug: str
    teams: list[TeamSummary] = field(default_factory=list)

    @property
    def total_kills(self) -> int:
        return sum(t.kills_inserted for t in self.teams)

    @property
    def total_games(self) -> int:
        return sum(t.games_added for t in self.teams)

    @property
    def total_matches(self) -> int:
        return sum(t.matches_added for t in self.teams)

    @property
    def total_errors(self) -> int:
        return sum(len(t.errors) for t in self.teams)


async def _backfill_one_team(
    team_slug: str,
    year: Optional[int],
    year_range: Optional[tuple[int, int]],
    source: str,
    delay: float,
    limit: Optional[int],
    dry_run: bool,
    sem: asyncio.Semaphore,
) -> TeamSummary:
    """Run one team's backfill inside the semaphore. Each team gets its
    own GolggClient instance (the rate limit is per-client)."""
    summary = TeamSummary(team_slug=team_slug)
    _get_team, process_year, _BR, _YR = _import_backfill_team()
    team = _get_team(team_slug)
    if team is None:
        summary.errors.append("unknown_team")
        return summary

    if year is not None:
        years = [year]
    elif year_range is not None:
        lo, hi = sorted(year_range)
        years = list(range(lo, hi + 1))
    elif team.get("default_year_range"):
        lo, hi = team["default_year_range"]
        years = list(range(lo, hi + 1))
    else:
        from datetime import datetime, timezone
        cur = datetime.now(timezone.utc).year
        years = list(range(cur - 2, cur + 1))

    async with sem:
        log.info("backfill_team_start", team=team_slug,
                 years=years, source=source)
        # process_year is sync and CPU/IO-bound on requests + DB writes.
        # Run inside to_thread so the asyncio loop can interleave teams.
        for y in years:
            try:
                yr = await asyncio.to_thread(
                    process_year,
                    team=team, year=y, source=source,
                    delay=delay, limit=limit, dry_run=dry_run,
                )
            except Exception as e:
                summary.errors.append(f"year_{y}: {type(e).__name__}: {str(e)[:80]}")
                continue
            summary.kills_inserted += yr.kills_inserted
            summary.games_added += yr.games_added
            summary.matches_added += yr.matches_added
            summary.errors.extend(yr.errors)
            if limit is not None and summary.kills_inserted >= limit:
                break

    return summary


# ── Top-level orchestration ───────────────────────────────────────────

async def _async_backfill_league(args: argparse.Namespace) -> LeagueReport:
    league = _get_league_by_slug(args.league)
    if league is None:
        raise SystemExit(f"Unknown league slug: {args.league!r}")

    explicit_teams = args.teams.split(",") if args.teams else None
    team_slugs = _team_slugs_for_league(league, explicit_teams)
    if args.limit_teams and args.limit_teams > 0:
        team_slugs = team_slugs[: args.limit_teams]

    if not team_slugs:
        raise SystemExit(
            f"No teams to back up for league {args.league!r}. "
            f"Pass --teams or wait for league_config.team_slugs to be populated."
        )

    log.info("backfill_league_plan",
             league=args.league, n_teams=len(team_slugs),
             concurrency=args.concurrency)

    sem = asyncio.Semaphore(max(1, args.concurrency))
    year_range = tuple(args.year_range) if args.year_range else None
    tasks = [
        _backfill_one_team(
            slug, args.year, year_range, args.source,
            args.delay, args.limit, args.dry_run, sem,
        )
        for slug in team_slugs
    ]
    summaries = await asyncio.gather(*tasks, return_exceptions=False)

    report = LeagueReport(league_slug=league["slug"])
    report.teams = list(summaries)
    return report


def _print_report(report: LeagueReport, dry_run: bool) -> None:
    print()
    print(f"=== backfill_league({report.league_slug}) ===")
    for t in report.teams:
        print(f"  {t.team_slug:<24} "
              f"kills={t.kills_inserted:<6} "
              f"games={t.games_added:<4} "
              f"matches={t.matches_added:<4} "
              f"errors={len(t.errors)}")
        for e in t.errors[:2]:
            print(f"      err: {e}")
    suffix = " (dry-run)" if dry_run else ""
    print()
    print(f"=== TOTAL{suffix}: kills={report.total_kills} "
          f"games={report.total_games} "
          f"matches={report.total_matches} "
          f"errors={report.total_errors} ===")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="backfill_league",
        description="Backfill every team in a league.",
    )
    p.add_argument("--league", required=True,
                   help="League slug, e.g. 'lec', 'lfl', 'lcs'.")
    p.add_argument("--year", type=int, default=None,
                   help="Process only this year (single int).")
    p.add_argument("--year-range", type=int, nargs=2, default=None,
                   metavar=("START", "END"),
                   help="Inclusive year range, e.g. --year-range 2021 2026.")
    p.add_argument("--source", choices=("golgg", "leaguepedia", "both"),
                   default="golgg",
                   help="Data source. Default: golgg.")
    p.add_argument("--limit", type=int, default=None,
                   help="Per-team stop after N kills inserted.")
    p.add_argument("--limit-teams", type=int, default=None,
                   help="Process only the first N teams (debug).")
    p.add_argument("--teams", default=None,
                   help="Comma-separated team slugs to override the league catalog.")
    p.add_argument("--concurrency", type=int, default=3,
                   help="Max teams in flight at once (default 3, max 3).")
    p.add_argument("--dry-run", action="store_true",
                   help="Scrape, but don't write to Supabase.")
    p.add_argument("--delay", type=float, default=6.0,
                   help="Min seconds between gol.gg requests (default 6).")
    return p


# Apply observability lazily so this script can be imported in tests
# without invoking the decorator's Supabase calls.
def _make_main():
    try:
        from services.observability import run_logged
        deco = run_logged(module_name="backfill_league")
    except Exception:
        def deco(fn):
            return fn

    @deco
    async def _runner(args):
        return await _async_backfill_league(args)
    return _runner


_runner = _make_main()


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    # Cap concurrency hard at 3 — we don't want to hammer gol.gg even if
    # someone passes --concurrency 50.
    if args.concurrency > 3:
        log.warn("concurrency_capped", requested=args.concurrency, max=3)
        args.concurrency = 3

    try:
        report = asyncio.run(_runner(args))
    except SystemExit:
        raise
    except Exception as e:
        log.error("backfill_league_crashed", error=str(e)[:200])
        return 2

    _print_report(report, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
