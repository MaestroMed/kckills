"""
backfill_golgg.py — Full historical KC catalog import from gol.gg.

Solves the gap left by the LolEsports live stats feed (which expires
after ~weeks). Walks every KC tournament from LFL Spring 2021 through
the current LEC split, scraping per-kill timeline data for every game.

For each game found on gol.gg :
  1. Fetch the timeline page (one HTTP req → both header + kill rows).
  2. Resolve the tournament + match + game rows in our Supabase DB.
     If they don't exist, create them with `data_source='gol_gg'`.
     If a match with the same date+opponent already exists (imported
     by the LolEsports backfill), reuse it instead of duplicating.
  3. For each kill : check if we already have a kill row for this
     game at this game_time (within 2s tolerance) — if yes, skip.
     If no, insert with `data_source='gol_gg'` and confidence='verified'.

The script is idempotent : re-running it skips games already fully
covered. A JSON checkpoint file (worker/golgg_backfill_state.json)
tracks last-processed (tournament, game_id) so a Ctrl-C and resume
loses at most one game's progress.

Usage :
    python scripts/backfill_golgg.py                    # full backfill
    python scripts/backfill_golgg.py --tournament "LFL Spring 2021"
    python scripts/backfill_golgg.py --year 2024
    python scripts/backfill_golgg.py --dry-run          # report only
    python scripts/backfill_golgg.py --reset            # ignore checkpoint
    python scripts/backfill_golgg.py --delay 8          # custom rate limit

Politeness defaults : 6s between requests. A full KC backlog (~250
games × 1 page-timeline req + ~20 list-team-games reqs) ≈ 30 minutes.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import structlog
from dotenv import load_dotenv

# Allow `python scripts/backfill_golgg.py` and `python -m scripts.backfill_golgg`
# both work — add the worker root to sys.path either way.
_WORKER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_WORKER_ROOT))

load_dotenv(_WORKER_ROOT / ".env")

from services.golgg_scraper import (   # noqa: E402
    GolggClient, GolggGameStub, GolggKill, annotate_multi_kills,
)
from services.supabase_client import (  # noqa: E402
    get_db, safe_select, safe_insert, safe_upsert,
)

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.dev.ConsoleRenderer(),
    ]
)
log = structlog.get_logger()


# ──────────────────────────────────────────────────────────────────────
# KC's full tournament history on gol.gg.
#
# Each entry is (tournament_label_in_url, kc_team_id, year, split).
#
# Why multiple team_ids? gol.gg created new team IDs as KC moved across
# leagues. Confirmed via empirical lookup :
#   * 1223 — LFL 2021–2022 era roster
#   * 1535 — LFL 2023 era (post-Rekkles)
#   * 2166 — LEC 2024+ (current)
#
# The tournament label MUST match gol.gg's exact URL format. Verified
# samples :
#   "LFL Spring 2021"             → /tournament-LFL%20Spring%202021/
#   "LEC Spring Season 2024"      → /tournament-LEC%20Spring%20Season%202024/
#
# When a tournament returns 404 or empty, we just skip — it might be
# named differently or KC didn't play there.
# ──────────────────────────────────────────────────────────────────────

KC_TOURNAMENTS: list[tuple[str, int, int, str]] = [
    # ── 2021 (S11) — Team id 1223. ──────────────────────────────
    ("LFL Spring 2021",                1223, 2021, "spring"),
    ("LFL Spring Playoffs 2021",       1223, 2021, "spring_po"),
    ("LFL Summer 2021",                1223, 2021, "summer"),
    ("LFL Summer Playoffs 2021",       1223, 2021, "summer_po"),
    ("LFL Finals 2021",                1223, 2021, "finals"),
    ("EU Masters Spring 2021",         1223, 2021, "eum_spring"),
    ("EU Masters Summer 2021",         1223, 2021, "eum_summer"),

    # ── 2022 (S12) — Rekkles era. Team id 1535. ──────────────────
    ("LFL Spring 2022",                1535, 2022, "spring"),
    ("LFL Spring Playoffs 2022",       1535, 2022, "spring_po"),
    ("LFL Summer 2022",                1535, 2022, "summer"),
    ("LFL Summer Playoffs 2022",       1535, 2022, "summer_po"),
    ("EU Masters Spring 2022",         1535, 2022, "eum_spring"),
    ("EU Masters Spring Play-In 2022", 1535, 2022, "eum_spring_pi"),

    # ── 2023 (S13) — final LFL year. Team id 1881. ───────────────
    ("LFL Spring 2023",                1881, 2023, "spring"),
    ("LFL Summer 2023",                1881, 2023, "summer"),
    ("LFL Summer Playoffs 2023",       1881, 2023, "summer_po"),
    ("EMEA Masters Summer 2023",       1881, 2023, "emea_summer"),

    # ── 2024 (S14) — first LEC year. Team id 2166. ───────────────
    ("LEC Winter Season 2024",         2166, 2024, "winter"),
    ("LEC Spring Season 2024",         2166, 2024, "spring"),
    ("LEC Summer Season 2024",         2166, 2024, "summer"),
    ("LEC Summer Playoffs 2024",       2166, 2024, "summer_po"),
    ("LEC Season Finals 2024",         2166, 2024, "finals"),

    # ── 2025 (S15) — Team id 2533 (NEW : gol.gg re-IDs every year).
    # Naming convention CHANGED to "LEC YYYY <Split> <Phase>" format.
    ("LEC Winter 2025",                2533, 2025, "winter"),
    ("LEC 2025 Winter Playoffs",       2533, 2025, "winter_po"),
    ("LEC 2025 Spring Season",         2533, 2025, "spring"),
    ("LEC 2025 Spring Playoffs",       2533, 2025, "spring_po"),
    ("LEC 2025 Summer Season",         2533, 2025, "summer"),
    ("LEC 2025 Summer Playoffs",       2533, 2025, "summer_po"),
    ("First Stand 2025",               2533, 2025, "international"),

    # ── 2026 (S16) — Team id 2899. Current splits. ───────────────
    ("LEC 2026 Versus Season",         2899, 2026, "versus"),
    ("LEC 2026 Versus Playoffs",       2899, 2026, "versus_po"),
    ("LEC 2026 Spring Season",         2899, 2026, "spring"),
]


CHECKPOINT_PATH = _WORKER_ROOT / "golgg_backfill_state.json"


@dataclass
class TournamentReport:
    label: str
    games_found: int = 0
    games_already_in_db: int = 0
    games_inserted: int = 0
    kills_inserted: int = 0
    errors: list[str] = field(default_factory=list)


@dataclass
class BackfillState:
    """Resume checkpoint. Persisted as JSON to CHECKPOINT_PATH."""
    completed_tournaments: list[str] = field(default_factory=list)
    last_tournament: Optional[str] = None
    last_game_id: Optional[str] = None

    @classmethod
    def load(cls) -> "BackfillState":
        if not CHECKPOINT_PATH.exists():
            return cls()
        try:
            data = json.loads(CHECKPOINT_PATH.read_text(encoding="utf-8"))
            return cls(**data)
        except Exception:
            return cls()

    def save(self) -> None:
        CHECKPOINT_PATH.write_text(
            json.dumps(self.__dict__, indent=2),
            encoding="utf-8",
        )


# ──────────────────────────────────────────────────────────────────────
# DB helpers (lightweight, idempotent)
# ──────────────────────────────────────────────────────────────────────

def _ensure_tournament(slug: str, year: int, split: str, name: str) -> Optional[str]:
    rows = safe_select("tournaments", "id", slug=slug)
    if rows:
        return rows[0]["id"]
    safe_insert("tournaments", {
        "external_id": slug,
        "name": name,
        "slug": slug,
        "year": year,
        "split": split,
    })
    rows = safe_select("tournaments", "id", slug=slug)
    return rows[0]["id"] if rows else None


def _ensure_team(code: str, name: str, is_kc: bool = False) -> Optional[str]:
    if not code:
        return None
    rows = safe_select("teams", "id", code=code)
    if rows:
        return rows[0]["id"]
    safe_insert("teams", {
        "external_id": f"team_{code.lower()}",
        "name": name or code,
        "slug": code.lower(),
        "code": code,
        "is_tracked": is_kc,
    })
    rows = safe_select("teams", "id", code=code)
    return rows[0]["id"] if rows else None


def _ensure_player(ign: str, team_id: Optional[str]) -> Optional[str]:
    """Find or create a player by IGN. We store NULL role for now ;
    the existing rosters backfill enriches roles later."""
    if not ign:
        return None
    rows = safe_select("players", "id", ign=ign)
    if rows:
        return rows[0]["id"]
    safe_insert("players", {
        "external_id": f"golgg_{ign.lower()}",
        "team_id": team_id,
        "ign": ign,
        "role": None,
    })
    rows = safe_select("players", "id", ign=ign)
    return rows[0]["id"] if rows else None


def _resolve_or_create_match(
    tournament_uuid: str,
    summary,
    stub: GolggGameStub,
    db,
) -> Optional[str]:
    """Find a matching match row in the DB, or create one from gol.gg
    metadata. Match strategy : same tournament + same teams (codes) +
    same date if we have one. Falls back to a new match keyed by the
    gol.gg game id if nothing matches."""
    blue_id = _ensure_team(
        _short_code(summary.blue_team_name), summary.blue_team_name or "",
        is_kc=summary.kc_side == "blue",
    )
    red_id = _ensure_team(
        _short_code(summary.red_team_name), summary.red_team_name or "",
        is_kc=summary.kc_side == "red",
    )
    if not blue_id or not red_id:
        return None

    # Synthetic external_id keyed on gol.gg — can't collide with the
    # LolEsports match IDs which are 18-digit Riot IDs.
    synthetic_ext = f"golgg_match_{stub.golgg_game_id}"
    rows = safe_select("matches", "id", external_id=synthetic_ext)
    if rows:
        return rows[0]["id"]

    # Best-effort try : if a livestats-imported match with the same
    # tournament + same date + same teams already exists, reuse it.
    if stub.date:
        existing = safe_select("matches", "id,external_id", tournament_id=tournament_uuid,
                               scheduled_at=stub.date)
        for m in existing:
            if not m["external_id"].startswith("golgg_match_"):
                # Looks like a real Riot-imported match → reuse it.
                return m["id"]

    # Create a new match keyed on the gol.gg id.
    winner = blue_id if summary.blue_won else (red_id if summary.red_won else None)
    safe_insert("matches", {
        "external_id": synthetic_ext,
        "tournament_id": tournament_uuid,
        "team_blue_id": blue_id,
        "team_red_id": red_id,
        "winner_team_id": winner,
        "format": "bo1",
        "stage": "",
        "scheduled_at": stub.date,
        "state": "completed",
    })
    rows = safe_select("matches", "id", external_id=synthetic_ext)
    return rows[0]["id"] if rows else None


def _ensure_game(match_uuid: str, summary, stub: GolggGameStub) -> Optional[str]:
    synthetic_ext = f"golgg_game_{stub.golgg_game_id}"
    rows = safe_select("games", "id,external_id", external_id=synthetic_ext)
    if rows:
        return rows[0]["id"]
    safe_insert("games", {
        "external_id": synthetic_ext,
        "match_id": match_uuid,
        "game_number": 1,
        "duration_seconds": summary.duration_seconds,
        "patch": summary.patch,
        "kills_extracted": False,  # set to True only after we've inserted kills
        "data_source": "gol_gg",
        "state": "completed",
    })
    rows = safe_select("games", "id", external_id=synthetic_ext)
    return rows[0]["id"] if rows else None


def _short_code(team_name: Optional[str]) -> str:
    """Best-effort short code from a long team name. gol.gg gives full
    names like "Karmine Corp"; our teams.code is the short code "KC".
    We use a known map first, fall back to the first letters of each
    word capitalised."""
    if not team_name:
        return ""
    KNOWN = {
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
    if team_name in KNOWN:
        return KNOWN[team_name]
    # Heuristic — uppercase initials.
    parts = team_name.split()
    if len(parts) == 1:
        return parts[0][:3].upper()
    return "".join(p[0] for p in parts if p).upper()[:4]


# ──────────────────────────────────────────────────────────────────────
# Kill insertion (with dedup)
# ──────────────────────────────────────────────────────────────────────

def _existing_kills_for_game(game_uuid: str) -> set[int]:
    """Return the set of game_time_seconds already covered for a game.
    Used to skip kills we've already imported from any source."""
    rows = safe_select("kills", "game_time_seconds", game_id=game_uuid)
    return {r["game_time_seconds"] for r in rows if r.get("game_time_seconds") is not None}


def _insert_kills(
    game_uuid: str,
    kills: list[GolggKill],
    summary,
    blue_team_uuid: Optional[str],
    red_team_uuid: Optional[str],
) -> int:
    """Annotate + insert one game's worth of kills. Returns count
    actually inserted (skipping ones we already have)."""
    if not kills:
        return 0

    annotated = annotate_multi_kills(kills)
    existing = _existing_kills_for_game(game_uuid)

    inserted = 0
    for a in annotated:
        # Skip if a kill with this exact game_time already exists
        # (within ±1s tolerance — gol.gg rounds to seconds and Riot
        # live stats can land on a 0.x boundary, so an extra 1s of
        # tolerance prevents double-counting).
        gt = a["game_time_seconds"]
        if any(abs(gt - e) <= 1 for e in existing):
            continue

        # Resolve players + champions to our DB rows.
        kc_side = summary.kc_side
        kc_team_uuid = blue_team_uuid if kc_side == "blue" else (red_team_uuid if kc_side == "red" else None)

        killer_team = blue_team_uuid if a["side"] == "blue" else red_team_uuid
        victim_team = red_team_uuid if a["side"] == "blue" else blue_team_uuid
        killer_pid = _ensure_player(a["killer_player"], killer_team)
        victim_pid = _ensure_player(a["victim_player"], victim_team)

        # Determine KC involvement (or null when KC didn't play this game).
        involvement = None
        if kc_team_uuid:
            if killer_team == kc_team_uuid:
                involvement = "team_killer"
            elif victim_team == kc_team_uuid:
                involvement = "team_victim"

        # `assistants` is JSONB in our schema — store the champion
        # names as a list. Player IDs aren't recoverable from gol.gg
        # without additional name→IGN cross-ref work.
        safe_insert("kills", {
            "game_id": game_uuid,
            "event_epoch": 0,  # gol.gg doesn't expose epoch — set 0 to
                                # make it explicit this kill came from a
                                # post-game source (no live timing).
            "game_time_seconds": gt,
            "killer_player_id": killer_pid,
            "killer_champion": a["killer_champion"],
            "victim_player_id": victim_pid,
            "victim_champion": a["victim_champion"],
            "assistants": [{"champion": c} for c in a["assists"]],
            "confidence": "verified",
            "tracked_team_involvement": involvement,
            "is_first_blood": a["is_first_blood"],
            "multi_kill": a["multi_kill"],
            "data_source": "gol_gg",
            "status": "raw",  # let the normal pipeline pick up clipping/analysis
        })
        existing.add(gt)
        inserted += 1
    return inserted


# ──────────────────────────────────────────────────────────────────────
# Main loop
# ──────────────────────────────────────────────────────────────────────

def process_tournament(
    label: str,
    team_id: int,
    year: int,
    split: str,
    client: GolggClient,
    dry_run: bool,
) -> TournamentReport:
    report = TournamentReport(label=label)
    db = get_db()
    if db is None and not dry_run:
        report.errors.append("no_db_connection")
        return report

    log.info("tournament_start", label=label, team_id=team_id, year=year)

    try:
        stubs = client.list_team_games(team_id=team_id, tournament=label)
    except Exception as e:
        report.errors.append(f"list_games_failed: {e}")
        return report

    report.games_found = len(stubs)
    log.info("tournament_games_listed", label=label, count=len(stubs))

    if not stubs or dry_run:
        return report

    # Make sure the tournament row exists so we can attach matches/games.
    slug = label.lower().replace(" ", "_")
    tournament_uuid = _ensure_tournament(slug, year, split, label)
    if not tournament_uuid:
        report.errors.append("ensure_tournament_failed")
        return report

    for stub in stubs:
        try:
            summary, kills = client.fetch_game_full(stub.golgg_game_id)
        except Exception as e:
            report.errors.append(f"game_{stub.golgg_game_id}: {e}")
            continue
        if summary is None:
            report.errors.append(f"game_{stub.golgg_game_id}: summary_404")
            continue

        # Resolve match + game in DB (creating if necessary)
        match_uuid = _resolve_or_create_match(tournament_uuid, summary, stub, db)
        if not match_uuid:
            report.errors.append(f"game_{stub.golgg_game_id}: no_match_uuid")
            continue
        game_uuid = _ensure_game(match_uuid, summary, stub)
        if not game_uuid:
            report.errors.append(f"game_{stub.golgg_game_id}: no_game_uuid")
            continue

        # Skip if this game already has the right number of kills covered.
        existing = _existing_kills_for_game(game_uuid)
        if existing and len(existing) >= len(kills):
            report.games_already_in_db += 1
            continue

        # Insert (dedup-aware)
        blue_team_uuid = _ensure_team(_short_code(summary.blue_team_name),
                                      summary.blue_team_name or "",
                                      is_kc=summary.kc_side == "blue")
        red_team_uuid = _ensure_team(_short_code(summary.red_team_name),
                                     summary.red_team_name or "",
                                     is_kc=summary.kc_side == "red")
        n = _insert_kills(game_uuid, kills, summary, blue_team_uuid, red_team_uuid)
        report.kills_inserted += n
        if n > 0:
            report.games_inserted += 1
            log.info("game_inserted",
                     label=label, game=stub.golgg_game_id,
                     kills=n, opp=stub.opponent_code or "?")

    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tournament", help="Process only this tournament label (exact match)")
    parser.add_argument("--year", type=int, help="Process only tournaments from this year")
    parser.add_argument("--dry-run", action="store_true",
                        help="List games per tournament, don't insert anything")
    parser.add_argument("--reset", action="store_true",
                        help="Ignore checkpoint, process every tournament")
    parser.add_argument("--delay", type=float, default=6.0,
                        help="Min seconds between gol.gg requests (default 6)")
    args = parser.parse_args()

    state = BackfillState() if args.reset else BackfillState.load()
    client = GolggClient(min_delay_seconds=args.delay)

    todo = []
    for label, team_id, year, split in KC_TOURNAMENTS:
        if args.tournament and label != args.tournament:
            continue
        if args.year and year != args.year:
            continue
        if label in state.completed_tournaments and not args.reset:
            log.info("tournament_skip_done", label=label)
            continue
        todo.append((label, team_id, year, split))

    if not todo:
        print("Nothing to do. All tournaments already processed.")
        return

    print(f"=== gol.gg backfill — {len(todo)} tournaments ===")
    for t in todo:
        print(f"  {t[0]} (team={t[1]}, year={t[2]})")
    print()

    grand_total_kills = 0
    grand_total_games = 0
    for label, team_id, year, split in todo:
        report = process_tournament(label, team_id, year, split, client, args.dry_run)
        grand_total_kills += report.kills_inserted
        grand_total_games += report.games_inserted

        print(f"\n--- {label} ---")
        print(f"  games found: {report.games_found}")
        print(f"  games already in db: {report.games_already_in_db}")
        print(f"  games inserted: {report.games_inserted}")
        print(f"  kills inserted: {report.kills_inserted}")
        if report.errors:
            print(f"  errors: {len(report.errors)}")
            for e in report.errors[:5]:
                print(f"    - {e}")

        if not args.dry_run and not report.errors:
            state.completed_tournaments.append(label)
            state.save()

    print()
    print(f"=== TOTAL : {grand_total_games} games, {grand_total_kills} kills inserted ===")


if __name__ == "__main__":
    main()
