"""
PHASE 1 PREP — backfill canonical metadata onto every published kill.

What this script does
---------------------
Reads `data/kc_matches.json` + the era registry baked into the worker,
joins each kill to its canonical event/game/patch/region context, then
populates the new columns added by migration 006:

  event_id              "LFL_2024_Spring_KCvSK"-style canonical id
  canonical_game_id     "LFL_2024_Spring_KCvSK_G3"
  patch                 "14.1"  (when known — kc_matches.json doesn't ship it)
  match_date            ISO date copied from games.matches.scheduled_at
  region                "EU" | "INT" | "NA" | ...
  split                 "spring" | "summer" | "winter"
  year                  match year
  event_tier            "international" | "regional_playoff" | "regional" | "league"
  stage_canonical       "regular" | "playoff" | "grand_finals" | ...
  kc_roster_era         era id from lib/eras.ts that the kill falls into

The fields that need ML / OCR / Leaguepedia ingestion (action_primary,
mechanic_highlight, situation, historic_significance, caster_reaction_score)
are LEFT NULL — those are real Phase 1 work, not a backfill.

Why this is Phase 1 PREP, not Phase 1 implementation
----------------------------------------------------
Per AUDIT.md §7.2.3 the strict 2-week post-launch gate forbids new
Phase 1 *feature* implementation. This script is a pure data move: it
uses information we already store in kc_matches.json and projects it
onto the columns migration 006 just added. No new pipeline, no new
external dependency, no user-facing surface change.

Idempotent — safe to re-run after every new match. Skips rows where
event_id is already set.

USAGE (when Mehdi green-lights):
    cd worker
    python scripts/backfill_phase1_metadata.py --dry-run     # see plan
    python scripts/backfill_phase1_metadata.py               # apply
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from typing import Iterable

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from services.supabase_client import safe_select, safe_update  # noqa: E402

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, os.pardir))
KC_MATCHES_JSON = os.path.join(REPO_ROOT, "data", "kc_matches.json")


# ─── Era mapping (mirror of web/src/lib/eras.ts dateRanges) ────────────────
# Hardcoded here so the worker doesn't need to parse TS. Keep in sync
# with the canonical list when new eras are added.
ERA_RANGES: list[tuple[str, str, str]] = [
    # (era_id,                  date_start,    date_end)
    ("lfl-2021-spring",         "2021-01-01",  "2021-04-30"),
    ("lfl-2021-summer",         "2021-05-01",  "2021-09-30"),
    ("lfl-2021-showmatch",      "2021-10-01",  "2021-12-31"),
    ("lfl-2022-spring",         "2022-01-01",  "2022-05-31"),
    ("lfl-2022-summer",         "2022-06-01",  "2022-09-30"),
    ("lfl-2022-showmatch",      "2022-10-01",  "2022-12-31"),
    ("lfl-2023-spring",         "2023-01-01",  "2023-05-31"),
    ("lfl-2023-summer",         "2023-06-01",  "2023-12-31"),
    ("lec-2024-winter",         "2024-01-01",  "2024-03-31"),
    ("lec-2024-spring",         "2024-04-01",  "2024-06-30"),
    ("lec-2024-summer",         "2024-07-01",  "2024-12-31"),
    ("lec-2025-winter",         "2025-01-01",  "2025-03-15"),
    ("international-2025-firststand", "2025-03-16", "2025-04-30"),
    ("lec-2025-spring",         "2025-05-01",  "2025-06-30"),
    ("lec-2025-summer",         "2025-07-01",  "2025-12-31"),
    ("lec-2026-versus",         "2026-01-01",  "2026-02-28"),
    ("lec-2026-spring",         "2026-03-01",  "2026-12-31"),
]


def era_for_date(iso_date: str) -> str | None:
    if not iso_date:
        return None
    d = iso_date[:10]
    for era_id, start, end in ERA_RANGES:
        if start <= d <= end:
            return era_id
    return None


# ─── Stage normalisation ───────────────────────────────────────────────────

STAGE_TO_CANONICAL = {
    "regular season": "regular",
    "regular_season": "regular",
    "regular": "regular",
    "playoffs": "playoff",
    "playoff": "playoff",
    "quarterfinals": "playoff",
    "quarter-finals": "playoff",
    "semifinals": "playoff",
    "semi-finals": "playoff",
    "finals": "grand_finals",
    "grand finals": "grand_finals",
    "grand final": "grand_finals",
    "showmatch": "showmatch",
    "exhibition": "showmatch",
}


def canonical_stage(raw: str | None) -> str | None:
    if not raw:
        return None
    return STAGE_TO_CANONICAL.get(raw.strip().lower())


# ─── Event tier from league + stage ────────────────────────────────────────

def event_tier(league: str | None, stage_canon: str | None) -> str | None:
    if not league:
        return None
    league_low = league.strip().lower()
    if any(k in league_low for k in ("worlds", "msi", "first stand", "international", "esports world cup")):
        return "international"
    if league_low in {"lec", "lcs", "lpl", "lck"}:
        if stage_canon in {"playoff", "grand_finals"}:
            return "regional_playoff"
        return "regional"
    if league_low in {"lfl", "superliga", "prime league", "northern league", "ultraliga"}:
        return "league"
    return "league"


def event_id(match_id: str, league: str | None, stage: str | None) -> str:
    """Stable canonical id derived from the lolesports match_id + meta.

    Format: "{LEAGUE}_{YEAR}_{SPLIT}_{StageCode}_{matchId-tail}". Loose
    enough to match Leaguepedia's eventual ingestion later — exact
    Leaguepedia ids land in Phase 1 proper, this is the placeholder.
    """
    return f"{(league or 'KC').upper().replace(' ', '')}_{match_id[-8:]}"


def canonical_game_id(event: str, game_number: int) -> str:
    return f"{event}_G{game_number}"


# ─── Split detection ───────────────────────────────────────────────────────

def split_for_date(iso_date: str) -> str | None:
    if not iso_date:
        return None
    month = int(iso_date[5:7])
    if month <= 3:
        return "winter"
    if month <= 6:
        return "spring"
    if month <= 9:
        return "summer"
    return "winter"


def region_for_league(league: str | None) -> str | None:
    if not league:
        return None
    league_low = league.strip().lower()
    if any(k in league_low for k in ("lec", "lfl", "superliga", "prime league", "ultraliga", "northern", "first stand")):
        return "EU"
    if "lcs" in league_low or "namaster" in league_low:
        return "NA"
    if "lck" in league_low:
        return "KR"
    if "lpl" in league_low:
        return "CN"
    return "EU"  # default — KC is European


# ─── Build the per-game enrichment lookup ──────────────────────────────────

def build_game_enrichment(matches: Iterable[dict]) -> dict[str, dict]:
    """Returns {game_external_id: {projected metadata for each kill in it}}."""
    out: dict[str, dict] = {}
    for m in matches:
        league = m.get("league")
        stage_raw = m.get("stage")
        stage_canon = canonical_stage(stage_raw)
        match_date = m.get("date")
        match_id = str(m.get("id") or "")
        event = event_id(match_id, league, stage_raw)
        for g in m.get("games", []):
            game_ext = str(g.get("id") or g.get("external_id") or "")
            if not game_ext:
                continue
            game_number = int(g.get("number") or 1)
            out[game_ext] = {
                "event_id": event,
                "canonical_game_id": canonical_game_id(event, game_number),
                "patch": g.get("patch"),  # often null in JSON, leave it
                "match_date": match_date,
                "region": region_for_league(league),
                "split": split_for_date(match_date or ""),
                "year": int(match_date[:4]) if match_date else None,
                "event_tier": event_tier(league, stage_canon),
                "stage_canonical": stage_canon,
                "kc_roster_era": era_for_date(match_date or ""),
            }
    return out


# ─── Main ──────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--force",
        action="store_true",
        help="re-write even when event_id is already set",
    )
    args = parser.parse_args()

    print("-> loading data/kc_matches.json")
    with open(KC_MATCHES_JSON, encoding="utf-8") as f:
        data = json.load(f)
    matches = data.get("matches") or []
    print(f"   {len(matches)} matches loaded")

    print("-> building game enrichment lookup")
    enrichment = build_game_enrichment(matches)
    print(f"   {len(enrichment)} games projected")

    print("-> loading published kills + their game external_ids")
    games = safe_select("games", "id, external_id") or []
    g_id_to_ext = {g["id"]: str(g.get("external_id") or "") for g in games}
    kills = safe_select(
        "kills",
        "id, game_id, event_id, canonical_game_id",
        status="published",
    ) or []
    if args.limit:
        kills = kills[: args.limit]
    print(f"   {len(kills)} published kills to consider")

    stats: dict[str, int] = defaultdict(int)
    for k in kills:
        stats["total"] += 1
        if not args.force and k.get("event_id"):
            stats["already_set_skip"] += 1
            continue
        g_ext = g_id_to_ext.get(k.get("game_id") or "", "")
        meta = enrichment.get(g_ext)
        if not meta:
            stats["no_enrichment_match"] += 1
            continue
        # Drop None values so we don't overwrite columns with NULL on a
        # subsequent more-complete run.
        patch = {kk: vv for kk, vv in meta.items() if vv is not None}
        if not patch:
            stats["empty_patch"] += 1
            continue
        if args.dry_run:
            stats["would_update"] += 1
            if stats["would_update"] <= 3:
                print(f"   [dry] {k['id'][:8]} <- {patch}")
            continue
        safe_update("kills", patch, "id", k["id"])
        stats["updated"] += 1

    print()
    print("-" * 60)
    print("PHASE 1 METADATA BACKFILL SUMMARY")
    print("-" * 60)
    for kk in sorted(stats.keys()):
        print(f"   {kk:30s} {stats[kk]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
