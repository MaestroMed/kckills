"""
BACKFILL ASSISTS — Re-harvest assists from livestats for ALL existing kills.

For each game:
1. Walk the livestats frames (same as harvester)
2. Detect kills with FULL assist attribution
3. Match each detected kill to the existing DB kill (by game_time)
4. Update the assistants field + recompute fight_type
5. Mark kills whose fight_type changed for re-description

This is a one-shot fix. After this, the harvester will detect assists
natively for all new kills.
"""
import asyncio
import json
import os
import sys
import time as time_mod
from collections import defaultdict
from datetime import datetime, timedelta, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()

import httpx

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
FEED = "https://feed.lolesports.com/livestats/v1"

MATCH_WINDOW = 15  # seconds tolerance for matching detected kill to DB kill


def classify_fight(n_concurrent: int, n_assists: int, multi_kill: str | None) -> str:
    """Proper fight type from assists + concurrent kills."""
    if multi_kill:
        mk = multi_kill.lower()
        if mk in ("triple", "quadra"):
            return "solo_kill"  # carry moment
        if mk == "penta":
            return "teamfight_5v5" if n_concurrent >= 5 else "solo_kill"

    if n_concurrent <= 1:
        if n_assists == 0:
            return "solo_kill"
        elif n_assists == 1:
            return "pick"
        else:
            return "gank"
    if n_concurrent == 2:
        return "skirmish_2v2"
    if n_concurrent == 3:
        return "skirmish_3v3"
    if n_concurrent <= 5:
        return "teamfight_4v4"
    return "teamfight_5v5"


def harvest_kills_with_assists(ext_game_id: str) -> list[dict]:
    """Walk livestats frames and return kills with full assist data."""
    resp = httpx.get(f"{FEED}/window/{ext_game_id}", timeout=15)
    if resp.status_code != 200:
        return []

    payload = resp.json()
    frames = payload.get("frames", [])
    meta = payload.get("gameMetadata", {})

    # Parse participants
    participants = {}
    for team_key, side in [("blueTeamMetadata", "blue"), ("redTeamMetadata", "red")]:
        for p in meta.get(team_key, {}).get("participantMetadata", []):
            pid = str(p["participantId"])
            participants[pid] = {
                "name": p.get("summonerName", "?"),
                "champion": p.get("championId", "?"),
                "side": side,
            }

    anchor_ts = frames[0].get("rfc460Timestamp", "")
    anchor_dt = datetime.fromisoformat(anchor_ts.replace("Z", "+00:00"))

    prev_kda = {}
    all_kills = []
    t = 0
    consecutive_empty = 0

    while t < 3600:
        query_dt = anchor_dt + timedelta(seconds=t)
        # API requires timestamps aligned to 10-second boundaries
        epoch_s = int(query_dt.timestamp())
        aligned_s = (epoch_s // 10) * 10
        aligned_dt = datetime.fromtimestamp(aligned_s, tz=timezone.utc)
        ts_str = aligned_dt.strftime("%Y-%m-%dT%H:%M:%S") + "Z"

        try:
            resp = httpx.get(f"{FEED}/window/{ext_game_id}",
                             params={"startingTime": ts_str}, timeout=10)
        except Exception:
            t += 100
            continue

        if resp.status_code != 200 or not resp.json().get("frames"):
            consecutive_empty += 1
            if consecutive_empty > 5:
                break
            t += 100
            continue
        consecutive_empty = 0

        for frame in resp.json()["frames"]:
            curr_kda = {}
            for team_key in ("blueTeam", "redTeam"):
                for p in frame.get(team_key, {}).get("participants", []):
                    pid = str(p["participantId"])
                    curr_kda[pid] = {
                        "kills": p.get("kills", 0),
                        "deaths": p.get("deaths", 0),
                        "assists": p.get("assists", 0),
                    }

            if prev_kda:
                killers, victims, assistants_list = [], [], []
                for pid in curr_kda:
                    prev = prev_kda.get(pid, {"kills": 0, "deaths": 0, "assists": 0})
                    dk = curr_kda[pid]["kills"] - prev["kills"]
                    dd = curr_kda[pid]["deaths"] - prev["deaths"]
                    da = curr_kda[pid]["assists"] - prev["assists"]
                    info = participants.get(pid, {"name": "?", "champion": "?", "side": "?"})
                    if dk > 0:
                        killers.append({"pid": pid, "dk": dk, **info})
                    if dd > 0:
                        victims.append({"pid": pid, **info})
                    if da > 0:
                        assistants_list.append({"pid": pid, "da": da, **info})

                if killers:
                    frame_ts = frame.get("rfc460Timestamp", "")
                    if frame_ts:
                        frame_dt = datetime.fromisoformat(frame_ts.replace("Z", "+00:00"))
                        game_seconds = int((frame_dt - anchor_dt).total_seconds())
                    else:
                        game_seconds = t

                    for killer in killers:
                        opp_victims = [v for v in victims if v["side"] != killer["side"]]
                        victim = opp_victims[0] if opp_victims else {"name": "?", "champion": "?"}
                        kill_assists = [
                            a for a in assistants_list
                            if a["side"] == killer["side"] and a["pid"] != killer["pid"]
                        ]

                        all_kills.append({
                            "game_time": game_seconds,
                            "killer_champion": killer["champion"],
                            "victim_champion": victim.get("champion", "?"),
                            "killer_name": killer["name"],
                            "victim_name": victim.get("name", "?"),
                            "n_assists": len(kill_assists),
                            "assistants": [
                                {"name": a["name"], "champion": a["champion"]}
                                for a in kill_assists
                            ],
                            "n_concurrent": len(killers),
                        })

            prev_kda = curr_kda

        t += 100
        time_mod.sleep(0.3)

    return all_kills


def match_kill_to_db(detected: dict, db_kills: list[dict]) -> dict | None:
    """Find the DB kill that matches this detected kill by time + champions."""
    best = None
    best_dt = 999
    for dbk in db_kills:
        db_gt = dbk.get("game_time_seconds") or 0
        dt = abs(db_gt - detected["game_time"])
        if dt > MATCH_WINDOW:
            continue
        # Champion match (fuzzy — champion names might differ slightly)
        if (dbk.get("killer_champion", "").lower() == detected["killer_champion"].lower()
                and dbk.get("victim_champion", "").lower() == detected["victim_champion"].lower()):
            if dt < best_dt:
                best = dbk
                best_dt = dt
    # If no champion match, try just by time
    if not best:
        for dbk in db_kills:
            db_gt = dbk.get("game_time_seconds") or 0
            dt = abs(db_gt - detected["game_time"])
            if dt <= 5 and dt < best_dt:  # very close time match
                best = dbk
                best_dt = dt
    return best


def main():
    print("=== BACKFILL ASSISTS ===\n")

    # Get all games
    r = httpx.get(f"{SUPABASE_URL}/rest/v1/games", params={
        "select": "id,external_id,game_number",
        "kills_extracted": "eq.true",
    }, headers=HEADERS)
    games = r.json()
    # Only 2026 games (skip GX vs KC backfill)
    games = [g for g in games if not g["external_id"].startswith("113")]
    print(f"Games to process: {len(games)}")

    # Get all published kills
    r = httpx.get(f"{SUPABASE_URL}/rest/v1/kills", params={
        "status": "eq.published",
        "select": "id,game_id,game_time_seconds,killer_champion,victim_champion,fight_type,assistants,multi_kill",
    }, headers=HEADERS)
    all_db_kills = r.json()
    print(f"Published kills: {len(all_db_kills)}")

    # Group DB kills by game
    kills_by_game = defaultdict(list)
    for k in all_db_kills:
        kills_by_game[k["game_id"]].append(k)

    total_updated = 0
    total_fight_type_changed = 0
    fight_type_changes = []

    for g in games:
        gid = g["id"]
        ext = g["external_id"]
        db_kills = kills_by_game.get(gid, [])
        if not db_kills:
            continue

        print(f"\n  Game #{g['game_number']} ({ext}): {len(db_kills)} kills in DB")

        # Harvest with assists
        detected = harvest_kills_with_assists(ext)
        print(f"    Detected from livestats: {len(detected)} kills")

        if not detected:
            print(f"    SKIP: livestats returned 0 kills")
            continue

        # Match and update
        matched = 0
        for det in detected:
            db_kill = match_kill_to_db(det, db_kills)
            if not db_kill:
                continue

            matched += 1
            old_ft = db_kill.get("fight_type", "?")
            new_ft = classify_fight(
                det["n_concurrent"], det["n_assists"], db_kill.get("multi_kill")
            )

            patch = {
                "assistants": json.dumps(det["assistants"]),
            }
            if new_ft != old_ft:
                patch["fight_type"] = new_ft
                total_fight_type_changed += 1
                fight_type_changes.append({
                    "id": db_kill["id"][:8],
                    "kill": f"{det['killer_champion']}->{det['victim_champion']}",
                    "old": old_ft,
                    "new": new_ft,
                    "assists": det["n_assists"],
                })

            # Update DB
            httpx.patch(
                f"{SUPABASE_URL}/rest/v1/kills?id=eq.{db_kill['id']}",
                headers={**HEADERS, "Content-Type": "application/json", "Prefer": "return=minimal"},
                json=patch,
            )
            total_updated += 1

        print(f"    Matched: {matched}/{len(detected)}")

    print(f"\n{'='*60}")
    print(f"TOTAL: {total_updated} kills updated with assists")
    print(f"Fight type changed: {total_fight_type_changed}")

    if fight_type_changes:
        print(f"\n--- Fight type transitions ---")
        # Count transitions
        transitions = defaultdict(int)
        for c in fight_type_changes:
            transitions[(c["old"], c["new"])] += 1
        for (old, new), count in sorted(transitions.items(), key=lambda x: -x[1]):
            print(f"  {old:>15} -> {new:<15} : {count}")

    # Save changes for reference
    with open("assist_backfill_results.json", "w") as f:
        json.dump(fight_type_changes, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
