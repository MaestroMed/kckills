"""
BACKFILL_TEAM_IDS_FROM_LOLESPORTS — Resolve NULL team_blue_id /
team_red_id by querying the lolesports API directly.

Why this on top of backfill_team_ids.py
----------------------------------------
backfill_team_ids.py reads from game_participants. For 14 old matches
(SK 20/04 and 13 others from Feb-Mar 2026), game_participants is empty
because the harvester never extracted KDA per player. So that script
returns "no participants" and can't resolve the sides.

This script bypasses the participants table entirely. It calls
lolesports `getEventDetails(match_external_id)` and reads the `match.teams`
array (each item has id + code). Any team not yet in our `teams` table
gets INSERTed from the lolesports payload. Then we PATCH the match.

Same convention as sentinel.py : `teams[0]=blue, teams[1]=red`. The
per-game side is independent (game_participants stores it correctly when
populated), but for the matches table, "the two teams playing" is what
we need.

Run
---
  python scripts/backfill_team_ids_from_lolesports.py             # dry-run
  python scripts/backfill_team_ids_from_lolesports.py --commit    # apply

Idempotent : re-runs on already-fixed matches are no-ops (the WHERE
clause filters them out).
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import httpx  # noqa: E402

from services import lolesports_api  # noqa: E402
from services.supabase_client import (  # noqa: E402
    get_db,
    safe_insert,
    safe_select,
    safe_update,
)


SK_MATCH_EXTERNAL_ID = "115548668059589320"


def _fetch_broken_matches() -> list[dict]:
    db = get_db()
    if not db:
        print("ERROR : Supabase client unavailable.")
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


def _resolve_or_insert_team(team: dict) -> str | None:
    """Mirror sentinel._resolve_team_id but importable here without
    circular dependency. Returns the teams.id (UUID).
    """
    ext_id = (team.get("id") or "").strip()
    code = (team.get("code") or "").strip().upper()
    name = (team.get("name") or code or "").strip()

    if ext_id:
        rows = safe_select("teams", "id", external_id=ext_id)
        if rows:
            return rows[0]["id"]
    if code:
        rows = safe_select("teams", "id", code=code)
        if rows:
            return rows[0]["id"]
    if not code:
        return None

    payload = {
        "external_id": ext_id or f"team_{code.lower()}",
        "code": code,
        "name": name or code,
        "slug": code.lower(),
        "logo_url": team.get("image"),
        "is_tracked": code in {"KC"},
    }
    inserted = safe_insert("teams", payload)
    if inserted and inserted.get("id"):
        return inserted["id"]
    rows = safe_select("teams", "id", code=code)
    return rows[0]["id"] if rows else None


async def _resolve_match(ext_id: str) -> tuple[str | None, str | None, dict, dict] | None:
    """Returns (blue_id, red_id, blue_team_payload, red_team_payload)."""
    details = await lolesports_api.get_event_details(ext_id)
    if not details:
        return None
    match_data = details.get("match") or {}
    teams = match_data.get("teams") or []
    if len(teams) < 2:
        return None
    team_a, team_b = teams[0], teams[1]
    blue_id = _resolve_or_insert_team(team_a)
    red_id = _resolve_or_insert_team(team_b)
    return blue_id, red_id, team_a, team_b


def _team_label(team_id: str | None) -> str:
    if not team_id:
        return "<NULL>"
    rows = safe_select("teams", "code,name", id=team_id)
    if not rows:
        return f"<unknown {team_id[:8]}>"
    return f"{rows[0].get('code') or '?'} ({(rows[0].get('name') or '?')[:24]})"


async def main_async(commit: bool) -> int:
    print("-> fetching matches with NULL team_blue_id or team_red_id")
    matches = _fetch_broken_matches()
    print(f"   {len(matches)} broken matches found\n")

    if not matches:
        return 0

    stats = defaultdict(int)
    stats["candidates"] = len(matches)

    for m in matches:
        mid = m["id"]
        ext = m.get("external_id", "?")
        sched = (m.get("scheduled_at") or "?")[:16]
        cur_blue = m.get("team_blue_id")
        cur_red = m.get("team_red_id")

        result = await _resolve_match(ext)
        if not result:
            stats["api_failed"] += 1
            print(f"  {sched} ext={ext}  SKIP : lolesports getEventDetails returned no teams")
            continue

        blue_id, red_id, team_a, team_b = result
        new_blue = cur_blue or blue_id
        new_red = cur_red or red_id

        change_blue = (not cur_blue) and bool(blue_id)
        change_red = (not cur_red) and bool(red_id)
        sym_blue = "+" if change_blue else "."
        sym_red = "+" if change_red else "."
        print(
            f"  {sched} ext={ext}  "
            f"[{sym_blue}blue {_team_label(new_blue)}] "
            f"[{sym_red}red  {_team_label(new_red)}]"
        )

        if change_blue or change_red:
            if commit:
                payload = {}
                if change_blue:
                    payload["team_blue_id"] = blue_id
                if change_red:
                    payload["team_red_id"] = red_id
                if safe_update("matches", payload, "id", mid):
                    stats["patched"] += 1
                else:
                    stats["patch_failed"] += 1
            else:
                stats["would_patch"] += 1
        else:
            stats["nothing_to_change"] += 1

    print()
    print("-" * 60)
    print(("COMMITTED" if commit else "DRY-RUN") + " — summary")
    print("-" * 60)
    for k in sorted(stats.keys()):
        print(f"  {k:24s} {stats[k]}")

    # SK match status
    sk_rows = safe_select(
        "matches", "team_blue_id,team_red_id",
        external_id=SK_MATCH_EXTERNAL_ID,
    )
    if sk_rows:
        b = sk_rows[0].get("team_blue_id")
        r = sk_rows[0].get("team_red_id")
        if b and r:
            print(f"\nSK match resolved : blue={_team_label(b)} red={_team_label(r)}")
        else:
            print(f"\nSK match still missing : blue={b or 'NULL'} red={r or 'NULL'}")

    if not commit and stats.get("would_patch"):
        print("\nRe-run with --commit to apply.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", action="store_true", help="Apply patches.")
    args = ap.parse_args()

    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_SERVICE_KEY"):
        print("ERROR : SUPABASE_URL / SUPABASE_SERVICE_KEY missing")
        return 1

    return asyncio.run(main_async(args.commit))


if __name__ == "__main__":
    sys.exit(main())
