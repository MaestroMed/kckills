"""
backfill_vods_2025.py — Fill in `games.vod_youtube_id` for 2025 LEC games.

Wave 31a (2026-05-14) — DB gap audit showed 104/108 games in 2025 LEC
without a vod_youtube_id. backfill_history.py upserts matches but skips
existing games entirely, so those rows never get the VOD assignment.

This script fixes that specific gap :
  1. Select games where vod_youtube_id IS NULL AND state='completed'
  2. For each, GET /getEventDetails on the parent match
  3. Map the API's games[] by game_number → pull vod.parameter (YouTube ID)
     and vod.offset (seconds into the VOD where the game starts)
  4. UPDATE the games row

Idempotent — running it twice has no effect since the WHERE filter only
matches NULL rows. Conservative rate limit (1 req/sec) keeps us well
under the lolesports API's tolerance.

Usage :
  python worker/backfill_vods_2025.py            # everything
  python worker/backfill_vods_2025.py --year 2025 --limit 50
  python worker/backfill_vods_2025.py --dry-run
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime

import httpx
from dotenv import load_dotenv

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

_THIS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _THIS)
load_dotenv(os.path.join(_THIS, ".env"))

from services.supabase_client import safe_select, safe_update  # noqa: E402

API = "https://esports-api.lolesports.com/persisted/gw"
KEY = os.environ.get("LOL_ESPORTS_API_KEY", "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z")
HEADERS = {"x-api-key": KEY}

REQUEST_DELAY = 1.0  # seconds between getEventDetails calls


def fetch_event_details(match_external_id: str) -> dict | None:
    """Pull the full event payload — includes games[] with vod sub-objects."""
    try:
        r = httpx.get(
            f"{API}/getEventDetails",
            params={"hl": "fr-FR", "id": match_external_id},
            headers=HEADERS,
            timeout=15,
        )
        return r.json().get("data", {}).get("event")
    except Exception as e:
        print(f"    ERROR fetching {match_external_id}: {e}")
        return None


def extract_vod(game_payload: dict) -> tuple[str | None, int | None]:
    """Find the first YouTube VOD in a game payload. Returns (id, offset)."""
    vods = game_payload.get("vods") or []
    for v in vods:
        if v.get("provider") == "youtube":
            return (
                v.get("parameter"),
                int(v.get("offset", 0) or 0),
            )
    return None, None


def main(year: str | None, limit: int, dry_run: bool) -> int:
    print(f"=== backfill_vods_{year or 'all'} ===")
    print(f"  Now : {datetime.utcnow().isoformat()}Z")
    print(f"  Mode : {'DRY RUN' if dry_run else 'APPLY'}")
    print(f"  Limit : {limit}")
    print()

    # ─── Pull candidate games ────────────────────────────────────────
    games = safe_select(
        "games",
        "id,external_id,game_number,match_id,vod_youtube_id,state",
        # PostgREST doesn't support a complex WHERE here, we filter
        # client-side. Fine for the ~500 game window.
        limit=2000,
    ) or []
    print(f"  Pulled {len(games):,} games total from DB")

    candidates = [
        g for g in games
        if (g.get("vod_youtube_id") is None or g.get("vod_youtube_id") == "")
        and g.get("state") == "completed"
    ]
    print(f"  {len(candidates):,} need a VOD (vod_youtube_id IS NULL + state=completed)")

    if year:
        # Filter via match.scheduled_at year. Need to fetch matches first.
        match_ids = list({g["match_id"] for g in candidates if g.get("match_id")})
        matches = safe_select(
            "matches",
            "id,external_id,scheduled_at,state",
            limit=5000,
        ) or []
        wanted_match_ids = {
            m["id"] for m in matches
            if (m.get("scheduled_at") or "").startswith(year)
        }
        before = len(candidates)
        candidates = [g for g in candidates if g.get("match_id") in wanted_match_ids]
        print(f"  After year={year} filter : {len(candidates):,} (was {before:,})")
        # We also need an external_id lookup for those matches.
        match_ext_by_id = {m["id"]: m["external_id"] for m in matches}
    else:
        # No year filter — load every match external_id we need.
        all_matches = safe_select(
            "matches",
            "id,external_id",
            limit=5000,
        ) or []
        match_ext_by_id = {m["id"]: m["external_id"] for m in all_matches}

    # Cap to limit
    candidates = candidates[:limit]
    print(f"  Processing : {len(candidates):,} games this run")
    print()

    if not candidates:
        print("  Nothing to do.")
        return 0

    if dry_run:
        for g in candidates[:5]:
            print(f"  [DRY] would update game {g['id'][:8]} (match={match_ext_by_id.get(g['match_id'],'?')[:14]})")
        print(f"  [DRY] ... and {max(0, len(candidates)-5)} more")
        return 0

    # ─── Walk and update ─────────────────────────────────────────────
    # Group by match so we only fetch each match once.
    by_match: dict[str, list[dict]] = {}
    for g in candidates:
        mid = g.get("match_id")
        if not mid:
            continue
        by_match.setdefault(mid, []).append(g)

    print(f"  Distinct matches to fetch : {len(by_match):,}")
    print()

    updated = 0
    skipped = 0
    errors = 0
    for i, (match_uuid, match_games) in enumerate(by_match.items()):
        ext_id = match_ext_by_id.get(match_uuid)
        if not ext_id:
            skipped += len(match_games)
            continue

        if i and i % 10 == 0:
            print(f"  progress {i}/{len(by_match)} matches  "
                  f"(updated={updated} skipped={skipped} errors={errors})")

        event = fetch_event_details(ext_id)
        time.sleep(REQUEST_DELAY)  # always sleep, even on error, to be polite

        if not event:
            errors += len(match_games)
            continue
        api_games = event.get("match", {}).get("games") or []
        api_by_number = {g.get("number"): g for g in api_games if g.get("number")}

        for g_db in match_games:
            gn = g_db.get("game_number")
            api_game = api_by_number.get(gn)
            if not api_game:
                print(f"    SKIP game={g_db['id'][:8]} match_ext={ext_id} gn={gn}: no api game (api keys: {list(api_by_number.keys())})")
                skipped += 1
                continue
            api_state = api_game.get("state")
            # If the API marks this game as `unneeded` (BO5 ended early)
            # the game never actually happened on stage. The DB incorrectly
            # has it as state=completed. Flip it to `unneeded` so the gap
            # is closed without trying to backfill a VOD that doesn't exist.
            if api_state == "unneeded":
                try:
                    ok = safe_update("games", {"state": "unneeded"}, "id", g_db["id"])
                    if ok:
                        updated += 1
                        print(f"    FIX  game={g_db['id'][:8]} gn={gn}: state → unneeded (BO5 ended early)")
                    else:
                        errors += 1
                except Exception as e:
                    print(f"    ERR  state-flip failed for game {g_db['id'][:8]}: {e}")
                    errors += 1
                continue
            yt_id, offset = extract_vod(api_game)
            if not yt_id:
                print(f"    SKIP game={g_db['id'][:8]} gn={gn} state={api_state}: no YouTube vod (vods={[v.get('provider') for v in (api_game.get('vods') or [])]})")
                skipped += 1
                continue
            patch = {"vod_youtube_id": yt_id}
            if offset is not None:
                patch["vod_offset_seconds"] = offset
            try:
                ok = safe_update("games", patch, "id", g_db["id"])
                if ok:
                    updated += 1
                    print(f"    OK   game={g_db['id'][:8]} gn={gn} → vod={yt_id} +{offset}s")
                else:
                    errors += 1
                    print(f"    ERR  update returned falsy for game={g_db['id'][:8]}")
            except Exception as e:
                print(f"    ERR  update failed for game {g_db['id'][:8]}: {e}")
                errors += 1

    print()
    print(f"=== DONE : updated={updated} skipped={skipped} errors={errors} ===")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", default=None,
                        help="ISO year prefix to filter by (e.g. '2025'). Omit for all.")
    parser.add_argument("--limit", type=int, default=200,
                        help="Max games to process this run (default 200).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report candidates without writing.")
    args = parser.parse_args()
    sys.exit(main(args.year, args.limit, args.dry_run))
