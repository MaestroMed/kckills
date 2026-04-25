"""
backfill_team.py — Generic per-team historical backfill.

Generalises the KC-only `backfill_golgg.py` so any team (any league) can
be imported with one command. Backwards-compat is preserved : running

    python -m worker.scripts.backfill_team --team karmine-corp

must produce the same result the manual KC backfill produced (~9,878
kills 2021→2026, give or take dedup hits).

Pipeline per team
-----------------
1. Resolve the team via team_config.get_team_by_slug (BA owns it). If
   that module isn't importable yet, fall back to a built-in KC stub so
   the script keeps working in the meantime.

2. Resolve the per-year gol.gg team_id via
   historical_team_id_resolver.resolve_golgg_team_ids(slug, year_range).
   For KC this returns the known {2021:1223, ..., 2026:2899}.

3. For each year in --year-range :
     a. Scrape gol.gg via GolggClient.scrape_team_kills(slug, year, id)
        unless --source=leaguepedia.
     b. If --source includes leaguepedia (or gol.gg returned nothing
        AND --source=both), pull LeaguepediaScraper.query_team_games
        and synthesise approximate kills.
     c. Upsert tournaments + matches + games + kills via
        services.supabase_client.safe_insert / safe_upsert.

4. Print a summary : matches added, games added, kills added, errors.

Idempotency
-----------
Every insert is keyed on a stable `external_id` :
    matches  : "golgg_match_<game_id>"  /  "lpedia_match_<match_id>"
    games    : "golgg_game_<game_id>"   /  "lpedia_game_<game_id>"
    kills    : (game_id, killer_player_id, victim_player_id, event_epoch)
               unique partial index — see migration 030.

Re-running the script skips existing rows on duplicate-key conflict.

CLI
---
  python -m worker.scripts.backfill_team --team karmine-corp
  python -m worker.scripts.backfill_team --team karmine-corp --year 2024
  python -m worker.scripts.backfill_team --team karmine-corp --year-range 2021 2026
  python -m worker.scripts.backfill_team --team g2-esports --source leaguepedia
  python -m worker.scripts.backfill_team --team karmine-corp --dry-run
  python -m worker.scripts.backfill_team --team karmine-corp --limit 10

Args :
  --team         Team slug (mandatory). Example: "karmine-corp", "g2-esports".
  --year         Process only this year (single int).
  --year-range   Process years between two ints inclusive : "--year-range 2021 2026".
                 Defaults to a per-team default (KC = 2021..current).
  --source       golgg | leaguepedia | both (default "golgg").
  --limit        Stop after N kills inserted (sanity check / quick test).
  --dry-run      Run the scrape, don't insert anything. Print what would happen.
  --delay        Override the gol.gg per-request delay (default 6s).
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import structlog

# ── Path bootstrapping ────────────────────────────────────────────────
# Allow `python -m worker.scripts.backfill_team ...` and
# `python worker/scripts/backfill_team.py ...` to both work.
_HERE = Path(__file__).resolve()
_WORKER_ROOT = _HERE.parent.parent
_REPO_ROOT = _WORKER_ROOT.parent
if str(_WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(_WORKER_ROOT))
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Stub env defaults for offline/dry-run. The real worker .env wins.
try:
    from dotenv import load_dotenv
    load_dotenv(_WORKER_ROOT / ".env")
except Exception:
    pass

log = structlog.get_logger()


# ── Lazy imports — degrade gracefully when team_config isn't built yet ─
def _get_team_by_slug(slug: str) -> Optional[dict]:
    """Resolve a team via team_config.get_team_by_slug (BA owns).

    Returns a dict shaped like :
        {
            "slug": str,
            "name": str,
            "code": str,
            "external_id": str,
            "leaguepedia_name": str,    # canonical name for Cargo
            "golgg_team_ids": dict[int, int] | None,  # year → id
            "league_slug": str,         # e.g. "lec"
            "default_year_range": tuple[int, int] | None,
        }

    If team_config isn't importable yet (BA still building), we return
    a hard-coded KC fallback so the script still works for the headline
    use-case. Any other slug yields None.
    """
    try:
        from services import team_config  # type: ignore[attr-defined]
        getter = getattr(team_config, "get_team_by_slug", None)
        if getter is None:
            raise ImportError("team_config has no get_team_by_slug")
        t = getter(slug)
        if t is None:
            return None
        # Normalise the return shape : accept either a dict or a dataclass.
        if isinstance(t, dict):
            return t
        # Try dataclass-style attribute access.
        return _team_to_dict(t)
    except ImportError as e:
        log.info("team_config_unavailable_using_fallback", error=str(e)[:120])
        return _fallback_team(slug)


def _team_to_dict(t) -> dict:
    """Convert a TrackedTeam dataclass (services/team_config.py) into the
    dict shape this script consumes internally.

    Notable mapping :
      * `golgg_team_ids_history` keys are tagged like "lfl_2021", "lec_2024".
        We extract the trailing 4-digit year and merge with `golgg_team_id`
        (taken as the current year) to build {year: id}.
      * `league` → `league_slug`.
    """
    out: dict = {}
    for attr in ("slug", "name", "code", "leaguepedia_name"):
        v = getattr(t, attr, None)
        if v is not None:
            out[attr] = v

    # league_slug
    league = getattr(t, "league", None)
    if league is not None:
        out["league_slug"] = league

    # external_id : prefer lolesports id if available, else fall back.
    ext = getattr(t, "lolesports_team_id", None)
    out["external_id"] = ext or f"team_{out.get('slug', 'unknown')}"

    # Normalise per-year gol.gg ids.
    per_year: dict[int, int] = {}
    history = getattr(t, "golgg_team_ids_history", None) or {}
    for k, v in history.items():
        # Keys look like "lfl_2021" / "lec_2024" / sometimes plain "2025".
        # Find the trailing 4-digit year.
        try:
            year_str = str(k).rsplit("_", 1)[-1]
            year = int(year_str)
            per_year[year] = int(v)
        except (TypeError, ValueError):
            continue
    # The single "current" id from `golgg_team_id`. We assign it to the
    # current calendar year if no per-year entry already covers it.
    single = getattr(t, "golgg_team_id", None)
    if single:
        cur_year = datetime.now(timezone.utc).year
        per_year.setdefault(cur_year, int(single))
    if per_year:
        out["golgg_team_ids"] = per_year

    # default_year_range — derived from the per-year map, or 3 years.
    if per_year:
        out["default_year_range"] = (min(per_year), max(per_year))
    else:
        cur = datetime.now(timezone.utc).year
        out["default_year_range"] = (cur - 2, cur)
    return out


def _fallback_team(slug: str) -> Optional[dict]:
    """Hard-coded fallback so backfill_team --team karmine-corp keeps
    working before team_config is in place. ONLY KC is here ; any other
    slug returns None and the caller errors out cleanly."""
    if slug.lower() == "karmine-corp":
        return {
            "slug": "karmine-corp",
            "name": "Karmine Corp",
            "code": "KC",
            "external_id": "team_kc",
            "leaguepedia_name": "Karmine Corp",
            "golgg_team_ids": {
                2021: 1223, 2022: 1535, 2023: 1881,
                2024: 2166, 2025: 2533, 2026: 2899,
            },
            "league_slug": "lec",
            "default_year_range": (2021, 2026),
        }
    return None


# ── Lazy import for the @run_logged decorator ─────────────────────────
def _run_logged():
    try:
        from services.observability import run_logged
        return run_logged
    except Exception:
        # Fallback no-op decorator if observability import fails. Tests
        # patch _try_insert_run anyway so this should be harmless.
        def _identity(name=None):
            def deco(fn):
                return fn
            return deco
        return _identity


# ── Tournament label catalog ──────────────────────────────────────────
# When the per-team config doesn't supply tournament labels, we fall
# back on the generic per-year list from golgg_scraper.

def _tournament_labels_for_team(team: dict, year: int) -> list[str]:
    """Pick the gol.gg tournament URL labels for a team in a given year.

    For KC we re-use the exact list backfill_golgg.py uses to guarantee
    output parity. For any other team we use the per-year defaults from
    golgg_scraper._default_tournament_labels.
    """
    if team.get("slug") == "karmine-corp":
        return _kc_tournaments_for_year(year)
    from services.golgg_scraper import _default_tournament_labels
    return _default_tournament_labels(year)


def _kc_tournaments_for_year(year: int) -> list[str]:
    """KC's verified tournament catalog — copied verbatim from
    backfill_golgg.py.KC_TOURNAMENTS so we hit the same URLs."""
    catalog = {
        2021: [
            "LFL Spring 2021", "LFL Spring Playoffs 2021",
            "LFL Summer 2021", "LFL Summer Playoffs 2021",
            "LFL Finals 2021",
            "EU Masters Spring 2021", "EU Masters Summer 2021",
        ],
        2022: [
            "LFL Spring 2022", "LFL Spring Playoffs 2022",
            "LFL Summer 2022", "LFL Summer Playoffs 2022",
            "EU Masters Spring 2022", "EU Masters Spring Play-In 2022",
        ],
        2023: [
            "LFL Spring 2023", "LFL Summer 2023", "LFL Summer Playoffs 2023",
            "EMEA Masters Summer 2023",
        ],
        2024: [
            "LEC Winter Season 2024", "LEC Spring Season 2024",
            "LEC Summer Season 2024", "LEC Summer Playoffs 2024",
            "LEC Season Finals 2024",
        ],
        2025: [
            "LEC Winter 2025", "LEC 2025 Winter Playoffs",
            "LEC 2025 Spring Season", "LEC 2025 Spring Playoffs",
            "LEC 2025 Summer Season", "LEC 2025 Summer Playoffs",
            "First Stand 2025",
        ],
        2026: [
            "LEC 2026 Versus Season", "LEC 2026 Versus Playoffs",
            "LEC 2026 Spring Season",
        ],
    }
    return catalog.get(year, [])


# ── Persistence helpers (lightweight, idempotent) ─────────────────────

def _ensure_team(team: dict) -> Optional[str]:
    """Make sure a row exists in the teams table for this team. Returns
    the team UUID. If the team is already there (by slug or code), reuse."""
    from services.supabase_client import safe_select, safe_insert
    code = team.get("code") or team["slug"][:4].upper()
    rows = safe_select("teams", "id", code=code)
    if rows:
        return rows[0]["id"]
    safe_insert("teams", {
        "external_id": team.get("external_id") or f"team_{team['slug']}",
        "name": team.get("name") or team["slug"].title(),
        "slug": team["slug"],
        "code": code,
        "is_tracked": True,
    })
    rows = safe_select("teams", "id", code=code)
    return rows[0]["id"] if rows else None


def _ensure_opponent_team(team_name: str) -> Optional[str]:
    """Find/create an opponent team row from a free-text team name."""
    from services.supabase_client import safe_select, safe_insert
    if not team_name:
        return None
    code = _short_code(team_name)
    if not code:
        return None
    rows = safe_select("teams", "id", code=code)
    if rows:
        return rows[0]["id"]
    safe_insert("teams", {
        "external_id": f"team_{code.lower()}",
        "name": team_name,
        "slug": code.lower(),
        "code": code,
        "is_tracked": False,
    })
    rows = safe_select("teams", "id", code=code)
    return rows[0]["id"] if rows else None


# Same KNOWN map as scripts/backfill_golgg.py — kept duplicated here on
# purpose so we don't reach into a sibling script's private function.
_KNOWN_CODES = {
    "Karmine Corp": "KC",
    "Karmine Corp Blue": "KCB",
    "Fnatic": "FNC",
    "G2 Esports": "G2",
    "Vitality": "VIT",
    "Team Vitality": "VIT",
    "Team Heretics": "TH",
    "MAD Lions KOI": "MDK",
    "MAD Lions": "MAD",
    "Excel Esports": "XL",
    "Movistar Riders": "MR",
    "Rogue": "RGE",
    "SK Gaming": "SK",
    "Astralis": "AST",
    "BDS": "BDS",
    "Team BDS": "BDS",
    "GIANTX": "GX",
    "Misfits Premier": "MSFP",
    "Karmine": "KC",
}


def _short_code(team_name: Optional[str]) -> str:
    if not team_name:
        return ""
    if team_name in _KNOWN_CODES:
        return _KNOWN_CODES[team_name]
    parts = team_name.split()
    if len(parts) == 1:
        return parts[0][:3].upper()
    return "".join(p[0] for p in parts if p).upper()[:4]


def _ensure_tournament(label: str, year: int) -> Optional[str]:
    """Find/create a tournament row keyed on the gol.gg label."""
    from services.supabase_client import safe_select, safe_insert
    slug = label.lower().replace(" ", "_")
    rows = safe_select("tournaments", "id", slug=slug)
    if rows:
        return rows[0]["id"]
    safe_insert("tournaments", {
        "external_id": slug,
        "name": label,
        "slug": slug,
        "year": year,
        "split": "",
    })
    rows = safe_select("tournaments", "id", slug=slug)
    return rows[0]["id"] if rows else None


def _ensure_match(
    tournament_uuid: str,
    kill: dict,
    blue_team_id: Optional[str],
    red_team_id: Optional[str],
) -> Optional[str]:
    from services.supabase_client import safe_select, safe_insert
    ext = kill["match_id_external"]
    rows = safe_select("matches", "id", external_id=ext)
    if rows:
        return rows[0]["id"]
    winner = blue_team_id if kill.get("blue_won") else (red_team_id if kill.get("red_won") else None)
    safe_insert("matches", {
        "external_id": ext,
        "tournament_id": tournament_uuid,
        "team_blue_id": blue_team_id,
        "team_red_id": red_team_id,
        "winner_team_id": winner,
        "format": "bo1",
        "stage": "",
        "scheduled_at": kill.get("date"),
        "state": "completed",
    })
    rows = safe_select("matches", "id", external_id=ext)
    return rows[0]["id"] if rows else None


def _ensure_game(match_uuid: str, kill: dict) -> Optional[str]:
    from services.supabase_client import safe_select, safe_insert
    ext = kill["game_id_external"]
    rows = safe_select("games", "id", external_id=ext)
    if rows:
        return rows[0]["id"]
    safe_insert("games", {
        "external_id": ext,
        "match_id": match_uuid,
        "game_number": 1,
        "duration_seconds": kill.get("duration_seconds"),
        "patch": kill.get("patch"),
        "kills_extracted": False,
        "data_source": kill.get("data_source", "gol_gg"),
        "state": "completed",
    })
    rows = safe_select("games", "id", external_id=ext)
    return rows[0]["id"] if rows else None


def _ensure_player(ign: str) -> Optional[str]:
    from services.supabase_client import safe_select, safe_insert
    if not ign:
        return None
    rows = safe_select("players", "id", ign=ign)
    if rows:
        return rows[0]["id"]
    safe_insert("players", {
        "external_id": f"golgg_{ign.lower()}",
        "team_id": None,
        "ign": ign,
        "role": None,
    })
    rows = safe_select("players", "id", ign=ign)
    return rows[0]["id"] if rows else None


def _existing_kill_times(game_uuid: str) -> set[int]:
    from services.supabase_client import safe_select
    rows = safe_select("kills", "game_time_seconds", game_id=game_uuid)
    return {r["game_time_seconds"] for r in rows if r.get("game_time_seconds") is not None}


def _insert_kill(game_uuid: str, kill: dict, existing_times: set[int]) -> bool:
    """Insert one kill, dedup'd by ±1s on game_time_seconds. Returns
    True if actually inserted."""
    from services.supabase_client import safe_insert
    gt = kill["game_time_seconds"]
    if any(abs(gt - e) <= 1 for e in existing_times):
        return False
    killer_pid = _ensure_player(kill.get("killer_alias", ""))
    victim_pid = _ensure_player(kill.get("victim_alias", ""))
    safe_insert("kills", {
        "game_id": game_uuid,
        "event_epoch": 0,  # historical sources have no epoch
        "game_time_seconds": gt,
        "killer_player_id": killer_pid,
        "killer_champion": kill.get("killer_champion"),
        "victim_player_id": victim_pid,
        "victim_champion": kill.get("victim_champion"),
        "assistants": [{"champion": c} for c in kill.get("assist_champions", [])],
        "confidence": kill.get("confidence", "verified"),
        "tracked_team_involvement": kill.get("tracked_team_involvement"),
        "is_first_blood": kill.get("is_first_blood", False),
        "multi_kill": kill.get("multi_kill"),
        "data_source": kill.get("data_source", "gol_gg"),
        "status": "raw",
    })
    existing_times.add(gt)
    return True


# ── Per-year processing ───────────────────────────────────────────────

@dataclass
class YearReport:
    year: int
    source: str
    kills_scraped: int = 0
    kills_inserted: int = 0
    matches_added: int = 0
    games_added: int = 0
    errors: list[str] = field(default_factory=list)


def process_year(
    team: dict,
    year: int,
    source: str,
    delay: float,
    limit: Optional[int],
    dry_run: bool,
) -> YearReport:
    """Walk one (team, year) pair end-to-end. Returns a YearReport."""
    report = YearReport(year=year, source=source)

    # Resolve gol.gg team ids for the requested year. Seeds from team
    # config win ; cache + HTTP discovery fill the rest.
    from services.historical_team_id_resolver import HistoricalTeamIdResolver
    seeds = {}
    if team.get("golgg_team_ids"):
        # Normalise int keys (JSON might have strings).
        seeds[team["slug"]] = {
            int(y): int(tid) for y, tid in team["golgg_team_ids"].items()
        }
    resolver = HistoricalTeamIdResolver(seeds=seeds)

    golgg_id_map = resolver.resolve(
        team["slug"],
        year_range=(year, year),
        aliases=[team.get("name", "")] if team.get("name") else None,
    )
    golgg_id = golgg_id_map.get(year)

    kills: list[dict] = []

    if source in ("golgg", "both") and golgg_id:
        try:
            from services.golgg_scraper import GolggClient
            client = GolggClient(min_delay_seconds=delay,
                                 tracked_team_ids={golgg_id})
            labels = _tournament_labels_for_team(team, year)
            kills.extend(client.scrape_team_kills(
                team_slug=team["slug"],
                year=year,
                golgg_team_id=golgg_id,
                tournament_labels=labels,
            ))
        except Exception as e:
            report.errors.append(f"golgg: {type(e).__name__}: {str(e)[:120]}")

    if source in ("leaguepedia", "both") and not kills:
        try:
            from services.leaguepedia_scraper import LeaguepediaScraper
            lp = LeaguepediaScraper()
            lp_name = team.get("leaguepedia_name") or team.get("name") or team["slug"]
            games = lp.query_team_games(lp_name, year)
            for g in games:
                scoreboard = lp.query_game_scoreboard(g.game_id)
                kills.extend(lp.synthesise_kills_for_game(g, scoreboard))
        except Exception as e:
            report.errors.append(f"leaguepedia: {type(e).__name__}: {str(e)[:120]}")

    report.kills_scraped = len(kills)

    if dry_run:
        log.info("backfill_team_dry_run",
                 team=team["slug"], year=year, source=source,
                 kills_would_insert=len(kills))
        return report

    if not kills:
        return report

    # Group by game so we touch each game's existing-kills set just once.
    by_game: dict[str, list[dict]] = {}
    for k in kills:
        by_game.setdefault(k["game_id_external"], []).append(k)

    tracked_team_uuid = _ensure_team(team)

    for game_ext, game_kills in by_game.items():
        if not game_kills:
            continue
        first = game_kills[0]
        tournament_label = first.get("tournament") or ""
        tournament_uuid = _ensure_tournament(tournament_label, year) if tournament_label else None
        if not tournament_uuid:
            report.errors.append(f"no_tournament: {game_ext}")
            continue

        # Map blue / red team UUIDs from the kill dict's team names. The
        # tracked team gets the cached UUID we already created.
        blue_name = first.get("blue_team_name")
        red_name = first.get("red_team_name")
        blue_uuid = (tracked_team_uuid if blue_name == team.get("name")
                     else _ensure_opponent_team(blue_name))
        red_uuid = (tracked_team_uuid if red_name == team.get("name")
                    else _ensure_opponent_team(red_name))

        match_uuid = _ensure_match(tournament_uuid, first, blue_uuid, red_uuid)
        if not match_uuid:
            report.errors.append(f"no_match: {game_ext}")
            continue
        game_uuid = _ensure_game(match_uuid, first)
        if not game_uuid:
            report.errors.append(f"no_game: {game_ext}")
            continue

        existing = _existing_kill_times(game_uuid)
        before = len(existing)
        for k in game_kills:
            if limit is not None and report.kills_inserted >= limit:
                break
            if _insert_kill(game_uuid, k, existing):
                report.kills_inserted += 1
        if len(existing) > before:
            report.games_added += 1
        if limit is not None and report.kills_inserted >= limit:
            break

    # Best-effort match counter — # distinct match externals we touched.
    report.matches_added = len({k["match_id_external"] for k in kills})
    return report


# ── Top-level orchestration ───────────────────────────────────────────

@dataclass
class BackfillReport:
    team_slug: str
    years: list[YearReport] = field(default_factory=list)

    @property
    def total_kills(self) -> int:
        return sum(y.kills_inserted for y in self.years)

    @property
    def total_games(self) -> int:
        return sum(y.games_added for y in self.years)

    @property
    def total_matches(self) -> int:
        return sum(y.matches_added for y in self.years)

    @property
    def total_errors(self) -> int:
        return sum(len(y.errors) for y in self.years)


async def _async_backfill_team(args: argparse.Namespace) -> BackfillReport:
    """Wrapped in async so @run_logged can write its row. The actual
    work is sync — gol.gg + leaguepedia don't have an async client."""
    team = _get_team_by_slug(args.team)
    if team is None:
        raise SystemExit(f"Unknown team slug: {args.team!r}")

    # Year range resolution.
    if args.year:
        years = [args.year]
    elif args.year_range:
        lo, hi = sorted(args.year_range)
        years = list(range(lo, hi + 1))
    elif team.get("default_year_range"):
        lo, hi = team["default_year_range"]
        years = list(range(lo, hi + 1))
    else:
        # Sensible default : last 3 years.
        cur = datetime.now(timezone.utc).year
        years = list(range(cur - 2, cur + 1))

    report = BackfillReport(team_slug=team["slug"])

    # observability accounting via note().
    try:
        from services import observability
        observability.note(items_scanned=len(years))
    except Exception:
        pass

    remaining = args.limit
    for y in years:
        per_year_limit = remaining
        yr = process_year(
            team=team,
            year=y,
            source=args.source,
            delay=args.delay,
            limit=per_year_limit,
            dry_run=args.dry_run,
        )
        report.years.append(yr)
        if remaining is not None:
            remaining = max(0, remaining - yr.kills_inserted)
            if remaining == 0:
                break

    try:
        from services import observability
        observability.note(
            items_processed=report.total_kills,
            items_failed=report.total_errors,
        )
    except Exception:
        pass
    return report


# Apply observability decorator (lazily — imports happen at call time).
def _make_main():
    deco = _run_logged()
    @deco(module_name="backfill_team")
    async def _runner(args):
        return await _async_backfill_team(args)
    return _runner


_runner = _make_main()


def _print_report(report: BackfillReport, dry_run: bool) -> None:
    print()
    print(f"=== backfill_team({report.team_slug}) ===")
    for y in report.years:
        print(f"  {y.year} [{y.source}] : "
              f"scraped={y.kills_scraped} "
              f"inserted={y.kills_inserted} "
              f"games={y.games_added} "
              f"matches={y.matches_added} "
              f"errors={len(y.errors)}")
        for e in y.errors[:3]:
            print(f"      err: {e}")
    suffix = " (dry-run)" if dry_run else ""
    print()
    print(f"=== TOTAL{suffix}: kills={report.total_kills} "
          f"games={report.total_games} "
          f"matches={report.total_matches} "
          f"errors={report.total_errors} ===")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="backfill_team",
        description="Generic team historical backfill (gol.gg + leaguepedia).",
    )
    p.add_argument("--team", required=True,
                   help="Team slug, e.g. 'karmine-corp', 'g2-esports'.")
    p.add_argument("--year", type=int, default=None,
                   help="Process only this year (single int).")
    p.add_argument("--year-range", type=int, nargs=2, default=None,
                   metavar=("START", "END"),
                   help="Inclusive year range, e.g. --year-range 2021 2026.")
    p.add_argument("--source", choices=("golgg", "leaguepedia", "both"),
                   default="golgg",
                   help="Data source. Default: golgg.")
    p.add_argument("--limit", type=int, default=None,
                   help="Stop after N kills inserted (sanity check).")
    p.add_argument("--dry-run", action="store_true",
                   help="Scrape, but don't write to Supabase.")
    p.add_argument("--delay", type=float, default=6.0,
                   help="Min seconds between gol.gg requests (default 6).")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        report = asyncio.run(_runner(args))
    except SystemExit:
        raise
    except Exception as e:
        log.error("backfill_team_crashed", error=str(e)[:200])
        return 2
    _print_report(report, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
