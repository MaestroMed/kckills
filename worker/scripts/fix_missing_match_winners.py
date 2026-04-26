"""
fix_missing_match_winners.py — Backfill matches.winner_team_id where it
went unset by the live pipeline.

The Sentinel + harvester chain SHOULD set winner_team_id on every
completed match (it reads the LolEsports getEventDetails outcome). In
practice the worker sometimes restarts mid-flush or the upstream API
omits the winner field for fresh matches, leaving rows with
state='completed' AND winner_team_id IS NULL.

This script :
  1. Finds completed matches with NULL winner_team_id.
  2. For each match, looks at its games.winner_team_id values.
  3. If the majority of games show a clear winning team, fills
     matches.winner_team_id in.
  4. Skips matches where games are still kills_extracted=false (worker
     hasn't fully digested them yet — would risk a wrong call).

Idempotent : already-set matches are excluded by the SELECT filter ;
re-runs are no-ops once everything's filled.

Usage
═════
    python scripts/fix_missing_match_winners.py --dry-run
    python scripts/fix_missing_match_winners.py
    python scripts/fix_missing_match_winners.py --since-days 7

Why a separate script and not a worker daemon
══════════════════════════════════════════════
The harvester writes per-game winners as it processes the live stats
feed ; the match-level winner needs all games to be done first to be
authoritative. The natural fix would be a Postgres trigger but that
adds a moving piece. A periodic operator-run script is simpler and
hard-fails loudly if it can't make a decision.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from pathlib import Path

# Make the worker package importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import httpx


def _supabase() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("ABORT : SUPABASE_URL / SUPABASE_SERVICE_KEY missing in env")
        sys.exit(2)
    return url, key


def _fix_one(url: str, key: str, match: dict, dry_run: bool) -> str:
    """Decide the winner for one match. Returns one of :
        "set_kc"        — winner_team_id ← KC
        "set_opp"       — winner_team_id ← opponent
        "tied"          — both teams won the same number of games (unusual)
        "skipped_undecided" — no clear majority
        "skipped_no_games"  — match has zero games with winners
        "skipped_unfinished"— some games still kills_extracted=false
    """
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    mid = match["id"]
    # Pull games for this match
    r = httpx.get(
        f"{url}/rest/v1/games?select=id,winner_team_id,kills_extracted&match_id=eq.{mid}",
        headers=h, timeout=15,
    )
    games = r.json() if r.status_code == 200 else []
    if not games:
        return "skipped_no_games"
    if any(g.get("kills_extracted") is False for g in games):
        return "skipped_unfinished"

    winners = [g.get("winner_team_id") for g in games if g.get("winner_team_id")]
    if not winners:
        return "skipped_no_games"
    counts = Counter(winners)
    most_common = counts.most_common()
    if len(most_common) > 1 and most_common[0][1] == most_common[1][1]:
        return "tied"
    winner_team_id = most_common[0][0]

    if dry_run:
        # Map to KC/opponent for the print
        kc_id = match.get("team_blue_id") if winner_team_id == match.get("team_blue_id") else match.get("team_red_id")
        return "set_kc" if winner_team_id in (match.get("team_blue_id"), match.get("team_red_id")) else "set_other"

    # Live UPDATE
    r = httpx.patch(
        f"{url}/rest/v1/matches?id=eq.{mid}",
        headers={**h, "Content-Type": "application/json", "Prefer": "return=minimal"},
        json={"winner_team_id": winner_team_id},
        timeout=15,
    )
    if r.status_code in (200, 204):
        # Identify side
        if winner_team_id == match.get("team_blue_id"):
            return "set_kc"  # blue
        if winner_team_id == match.get("team_red_id"):
            return "set_opp"  # red
        return "set_other"
    return "skipped_unfinished"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true",
                   help="Print what would change, no writes")
    p.add_argument("--since-days", type=int, default=None,
                   help="Only consider matches scheduled in last N days")
    args = p.parse_args()

    url, key = _supabase()
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    qs = [
        "select=id,team_blue_id,team_red_id,scheduled_at",
        "state=eq.completed",
        "winner_team_id=is.null",
        "order=scheduled_at.desc",
    ]
    if args.since_days is not None:
        from datetime import datetime, timedelta, timezone
        cutoff = (datetime.now(timezone.utc) - timedelta(days=args.since_days)).isoformat()
        qs.append(f"scheduled_at=gte.{cutoff}")
    r = httpx.get(f"{url}/rest/v1/matches?" + "&".join(qs), headers=h, timeout=30)
    matches = r.json() if r.status_code == 200 else []
    print(f"Mode      : {'DRY-RUN' if args.dry_run else 'LIVE'}")
    print(f"Candidates: {len(matches)} completed matches with NULL winner_team_id")
    print()

    counters: dict[str, int] = {}
    for m in matches:
        outcome = _fix_one(url, key, m, args.dry_run)
        counters[outcome] = counters.get(outcome, 0) + 1
        if outcome.startswith("set_"):
            sched = m.get("scheduled_at", "?")[:10]
            print(f"  {sched}  match={m['id'][:8]}  -> {outcome}")
        elif outcome.startswith("tied"):
            print(f"  {m['id'][:8]}  TIED — manual review needed")

    print()
    print("=" * 60)
    for k in sorted(counters):
        print(f"  {k:<22} : {counters[k]}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
