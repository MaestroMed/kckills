"""
BACKFILL_TEAM_IDS — Resolve NULL team_blue_id / team_red_id on the matches table.

Why
---
sentinel.py used to insert matches without populating team_blue_id /
team_red_id when the team CODE coming from lolesports wasn't yet in the
teams table. Result : the frontend join cannot resolve team names and
shows "?" everywhere. Specifically the SK match (external_id =
115548668059589320, 2026-04-20) has both team_blue_id and team_red_id
NULL.

How it heals
------------
For every match with a NULL side, we look at its games' game_participants
rows. Each participant row already has team_id + side ('blue' | 'red'),
so the most-frequent team_id per side IS the answer.

Run
---
  python scripts/backfill_team_ids.py             # dry-run
  python scripts/backfill_team_ids.py --commit    # apply
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import httpx  # noqa: E402

from services.supabase_client import (  # noqa: E402
    get_db,
    safe_select,
    safe_update,
)

SK_MATCH_EXTERNAL_ID = "115548668059589320"


def fetch_broken_matches() -> list[dict]:
    """Pull every match where at least one side is NULL."""
    db = get_db()
    if not db:
        print("ERROR : Supabase client unavailable (check SUPABASE_URL / KEY).")
        sys.exit(1)
    r = httpx.get(
        f"{db.base}/matches",
        headers=db.headers,
        params={
            "select": "id,external_id,scheduled_at,team_blue_id,team_red_id,stage",
            "or": "(team_blue_id.is.null,team_red_id.is.null)",
            "order": "scheduled_at.desc",
            "limit": "500",
        },
        timeout=30.0,
    )
    r.raise_for_status()
    return r.json() or []


def fetch_games_for_match(match_id: str) -> list[dict]:
    return safe_select("games", "id,external_id,game_number", match_id=match_id) or []


def fetch_participants_for_games(game_ids: list[str]) -> list[dict]:
    """Pull all game_participants for a list of games in ONE roundtrip."""
    if not game_ids:
        return []
    db = get_db()
    if not db:
        return []
    in_clause = "(" + ",".join(game_ids) + ")"
    r = httpx.get(
        f"{db.base}/game_participants",
        headers=db.headers,
        params={
            "select": "game_id,team_id,side",
            "game_id": f"in.{in_clause}",
        },
        timeout=20.0,
    )
    r.raise_for_status()
    return r.json() or []


def resolve_sides(participants: list[dict]) -> tuple[str | None, str | None, dict]:
    """Aggregate participants -> (blue_team_id, red_team_id, debug_counts)."""
    blue_counts: Counter = Counter()
    red_counts: Counter = Counter()
    for p in participants:
        side = p.get("side")
        tid = p.get("team_id")
        if not tid:
            continue
        if side == "blue":
            blue_counts[tid] += 1
        elif side == "red":
            red_counts[tid] += 1
    blue_id = blue_counts.most_common(1)[0][0] if blue_counts else None
    red_id = red_counts.most_common(1)[0][0] if red_counts else None
    return blue_id, red_id, {"blue": dict(blue_counts), "red": dict(red_counts)}


def fetch_team_label(team_id: str | None) -> str:
    if not team_id:
        return "<NULL>"
    rows = safe_select("teams", "code,name", id=team_id)
    if not rows:
        return f"<unknown {team_id[:8]}>"
    return f"{rows[0].get('code') or '?'} ({(rows[0].get('name') or '?')[:24]})"


def patch_match(match_id: str, blue_id: str | None, red_id: str | None) -> bool:
    """PATCH only the columns we actually resolved — never overwrite a
    good ID with NULL."""
    payload = {}
    if blue_id:
        payload["team_blue_id"] = blue_id
    if red_id:
        payload["team_red_id"] = red_id
    if not payload:
        return False
    return safe_update("matches", payload, "id", match_id)


def report_sk_match(matches: list[dict], resolved: dict[str, tuple[str | None, str | None]]) -> None:
    sk = next((m for m in matches if m.get("external_id") == SK_MATCH_EXTERNAL_ID), None)
    if not sk:
        rows = safe_select(
            "matches",
            "id,external_id,team_blue_id,team_red_id",
            external_id=SK_MATCH_EXTERNAL_ID,
        )
        if not rows:
            print(f"\nSK match still missing: external_id={SK_MATCH_EXTERNAL_ID} not in matches table at all")
            return
        m = rows[0]
        if m.get("team_blue_id") and m.get("team_red_id"):
            print(f"\nSK match resolved: blue={m['team_blue_id']} red={m['team_red_id']}")
        else:
            print(
                f"\nSK match still missing: blue={m.get('team_blue_id') or 'NULL'} "
                f"red={m.get('team_red_id') or 'NULL'} (was not in broken list — inconsistent state)"
            )
        return

    blue, red = resolved.get(sk["id"], (sk.get("team_blue_id"), sk.get("team_red_id")))
    if blue and red:
        print(f"\nSK match resolved: blue={blue} red={red}")
        print(
            f"  -> {fetch_team_label(blue)} (blue) vs {fetch_team_label(red)} (red)"
        )
    else:
        reasons = []
        if not blue:
            reasons.append("blue side has no participants with team_id")
        if not red:
            reasons.append("red side has no participants with team_id")
        print(
            f"\nSK match still missing: {'; '.join(reasons) or 'unknown reason'}"
        )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", action="store_true", help="Apply patches. Default is dry-run.")
    args = ap.parse_args()

    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_KEY"):
        print("ERROR : SUPABASE_URL / SUPABASE_SERVICE_KEY missing from .env")
        return 1

    print("-> fetching matches with NULL team_blue_id or team_red_id")
    matches = fetch_broken_matches()
    print(f"   {len(matches)} broken matches found\n")

    if not matches:
        report_sk_match([], {})
        return 0

    resolved: dict[str, tuple[str | None, str | None]] = {}
    stats = defaultdict(int)
    stats["candidates"] = len(matches)

    for m in matches:
        mid = m["id"]
        ext = m.get("external_id", "?")
        sched = (m.get("scheduled_at") or "?")[:16]
        cur_blue = m.get("team_blue_id")
        cur_red = m.get("team_red_id")

        games = fetch_games_for_match(mid)
        if not games:
            stats["no_games"] += 1
            print(f"  {sched} ext={ext}  SKIP : no games")
            resolved[mid] = (cur_blue, cur_red)
            continue

        parts = fetch_participants_for_games([g["id"] for g in games])
        if not parts:
            stats["no_participants"] += 1
            print(f"  {sched} ext={ext}  SKIP : games have no participants")
            resolved[mid] = (cur_blue, cur_red)
            continue

        blue_id, red_id, dbg = resolve_sides(parts)
        new_blue = cur_blue or blue_id
        new_red = cur_red or red_id
        resolved[mid] = (new_blue, new_red)

        change_blue = (not cur_blue) and bool(blue_id)
        change_red = (not cur_red) and bool(red_id)

        sym_blue = "+" if change_blue else "."
        sym_red = "+" if change_red else "."
        print(
            f"  {sched} ext={ext}  games={len(games)} parts={len(parts)}  "
            f"[{sym_blue}blue {fetch_team_label(new_blue)}] "
            f"[{sym_red}red  {fetch_team_label(new_red)}]"
        )

        if change_blue or change_red:
            if args.commit:
                if patch_match(mid, blue_id if change_blue else None,
                               red_id if change_red else None):
                    stats["patched"] += 1
                else:
                    stats["patch_failed"] += 1
            else:
                stats["would_patch"] += 1
        else:
            stats["nothing_to_change"] += 1

        if not new_blue:
            stats["still_missing_blue"] += 1
        if not new_red:
            stats["still_missing_red"] += 1

    print()
    print("-" * 60)
    print(("COMMITTED" if args.commit else "DRY-RUN") + " — summary")
    print("-" * 60)
    for k in sorted(stats.keys()):
        print(f"  {k:28s} {stats[k]}")

    report_sk_match(matches, resolved)

    if not args.commit and stats.get("would_patch"):
        print("\nRe-run with --commit to apply the patches above.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
