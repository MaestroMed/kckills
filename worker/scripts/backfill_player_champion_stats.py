"""
backfill_player_champion_stats.py — per-player × per-champion aggregates.

WHY: game_participants is empty, so the site had no source of truth for
"player X is N% WR on champion Y" (the Vi showcase had to hand-set it).
This backfills the `player_champion_stats` table (migration 082) from
Leaguepedia Cargo — public, official pro-match data — so the frontend can
read winrate / KDA / games live.

Source: Leaguepedia ScoreboardPlayers (Link, Champion, PlayerWin, K/D/A,
DateTime UTC). One paginated query per player. Validated against gol.gg:
Yike on Vi = 52 games / 33 wins / 63% WR / 3.4 KDA (identical on both).

Scopes stored per (player, champion):
  - 'all'   : career
  - 'y2026' : games on/after 2026-01-01 (current-era slice)

Leaguepedia rate-limits HARD — requests are throttled + retried with
backoff. Re-run periodically (e.g. weekly, or after each KC match day).

Usage:
    python scripts/backfill_player_champion_stats.py            # all DB players
    python scripts/backfill_player_champion_stats.py --player Yike
    python scripts/backfill_player_champion_stats.py --dry-run  # no writes
"""

from __future__ import annotations

import argparse
import sys
import time
from collections import defaultdict
from pathlib import Path

_WORKER_ROOT = Path(__file__).resolve().parents[1]
if str(_WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(_WORKER_ROOT))

import httpx  # noqa: E402
import structlog  # noqa: E402

from services.supabase_client import safe_select, safe_upsert  # noqa: E402

log = structlog.get_logger()

CARGO_API = "https://lol.fandom.com/api.php"
UA = {"User-Agent": "kckills-data/1.0 (player champion stats backfill)"}
SEASON_FROM = "2026-01-01"   # boundary for the 'y2026' scope
REQ_DELAY = 3.0              # polite spacing between Cargo requests (seconds)
PAGE = 500                   # Cargo max rows per query


def _cargo_page(client: httpx.Client, link: str, offset: int) -> list[dict]:
    """One Cargo page of a player's scoreboard rows. Retries on rate-limit."""
    params = {
        "action": "cargoquery",
        "format": "json",
        "limit": str(PAGE),
        "offset": str(offset),
        "tables": "ScoreboardPlayers",
        "fields": (
            "ScoreboardPlayers.Champion,ScoreboardPlayers.PlayerWin,"
            "ScoreboardPlayers.Kills,ScoreboardPlayers.Deaths,"
            "ScoreboardPlayers.Assists,ScoreboardPlayers.DateTime_UTC"
        ),
        "where": f'ScoreboardPlayers.Link="{link}"',
        "order_by": "ScoreboardPlayers.DateTime_UTC DESC",
    }
    for attempt in range(6):
        try:
            r = client.get(CARGO_API, params=params, headers=UA, timeout=30.0)
            d = r.json()
        except Exception as e:  # noqa: BLE001
            log.warn("cargo_request_failed", link=link, error=str(e)[:160])
            time.sleep(4 * (attempt + 1))
            continue
        if isinstance(d, dict) and d.get("error"):
            code = d["error"].get("code")
            if code == "ratelimited":
                time.sleep(8 * (attempt + 1))
                continue
            log.warn("cargo_error", link=link, error=d["error"])
            return []
        return [row.get("title", {}) for row in d.get("cargoquery", [])]
    log.warn("cargo_giving_up", link=link, offset=offset)
    return []


def fetch_player_rows(client: httpx.Client, link: str) -> list[dict]:
    """All of a player's pro scoreboard rows (paginated)."""
    out: list[dict] = []
    offset = 0
    while True:
        page = _cargo_page(client, link, offset)
        out.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
        time.sleep(REQ_DELAY)
    return out


def aggregate(rows: list[dict]) -> dict[tuple[str, str], dict]:
    """(champion, scope) -> {games, wins, k, d, a}."""
    agg: dict[tuple[str, str], dict] = defaultdict(
        lambda: {"games": 0, "wins": 0, "k": 0, "d": 0, "a": 0}
    )
    for t in rows:
        champ = t.get("Champion")
        if not champ:
            continue
        win = t.get("PlayerWin") == "Yes"
        k = int(t.get("Kills") or 0)
        d = int(t.get("Deaths") or 0)
        a = int(t.get("Assists") or 0)
        # cargoquery returns the field as "DateTime UTC" (space).
        dt = (t.get("DateTime UTC") or t.get("DateTime_UTC") or "")[:10]
        scopes = ["all"] + (["y2026"] if dt >= SEASON_FROM else [])
        for scope in scopes:
            s = agg[(champ, scope)]
            s["games"] += 1
            s["wins"] += 1 if win else 0
            s["k"] += k
            s["d"] += d
            s["a"] += a
    return agg


def build_rows(link: str, player_id: str | None, agg: dict, min_games: int) -> list[dict]:
    rows: list[dict] = []
    for (champ, scope), s in agg.items():
        g = s["games"]
        if g < min_games:
            continue
        w = s["wins"]
        rows.append(
            {
                "player_link": link,
                "player_id": player_id,
                "champion": champ,
                "scope": scope,
                "games": g,
                "wins": w,
                "losses": g - w,
                "kills": s["k"],
                "deaths": s["d"],
                "assists": s["a"],
                "winrate": round(100 * w / g, 1),
                "kda": round((s["k"] + s["a"]) / max(1, s["d"]), 2),
                "source": "leaguepedia",
            }
        )
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--player", help="single Leaguepedia Link / ign (else all DB players)")
    ap.add_argument("--min-games", type=int, default=3, help="skip champions below this game count")
    ap.add_argument("--dry-run", action="store_true", help="fetch + aggregate, print, no DB writes")
    args = ap.parse_args()

    players = safe_select("players", "id,ign", _limit=500) or []
    if args.player:
        players = [p for p in players if (p.get("ign") or "").lower() == args.player.lower()]
        if not players:  # allow ad-hoc players not in our DB
            players = [{"id": None, "ign": args.player}]
    if not players:
        print("No players found (is the DB reachable?).")
        return 1

    client = httpx.Client()
    total_rows = 0
    try:
        for p in players:
            ign = p.get("ign")
            pid = p.get("id")
            if not ign:
                continue
            rows = fetch_player_rows(client, ign)
            if not rows:
                log.info("no_games", player=ign)
                time.sleep(REQ_DELAY)
                continue
            agg = aggregate(rows)
            built = build_rows(ign, pid, agg, args.min_games)
            if args.dry_run:
                top = sorted(built, key=lambda r: (-r["games"], r["scope"]))[:6]
                print(f"\n[{ign}] {len(rows)} pro games -> {len(built)} stat rows. Top:")
                for r in top:
                    print(
                        f"   {r['champion']:14} {r['scope']:6} "
                        f"{r['games']:3}g {r['winrate']:5}% WR  KDA {r['kda']}"
                    )
            else:
                if built:
                    safe_upsert(
                        "player_champion_stats",
                        built,
                        on_conflict="player_link,champion,scope",
                    )
                log.info("backfilled", player=ign, games=len(rows), rows=len(built))
            total_rows += len(built)
            time.sleep(REQ_DELAY)
    finally:
        client.close()

    verb = "would upsert" if args.dry_run else "upserted"
    print(f"\nDONE: {verb} {total_rows} champion-stat rows across {len(players)} player(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
