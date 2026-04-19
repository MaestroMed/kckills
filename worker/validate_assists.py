"""
VALIDATION: Parse real livestats frames for a game and show
every kill with FULL assist detection.

This validates our algorithm against real data before deploying.
"""
import httpx
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv()

FEED = "https://feed.lolesports.com/livestats/v1"


def get_game_id():
    """Get the most recent game external_id from Supabase."""
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    r = httpx.get(url + "/rest/v1/games", params={
        "select": "external_id,game_number",
        "kills_extracted": "eq.true",
        "order": "created_at.desc",
        "limit": "1"
    }, headers=h)
    game = r.json()[0]
    return game["external_id"], game["game_number"]


def main():
    if len(sys.argv) > 1:
        ext_id = sys.argv[1]
        gnum = "?"
    else:
        ext_id, gnum = get_game_id()
    print(f"Game: {ext_id} (#{gnum})")
    print()

    # Get anchor frame (first frame)
    resp = httpx.get(f"{FEED}/window/{ext_id}", timeout=15)
    if resp.status_code != 200:
        print(f"Livestats returned {resp.status_code} — feed expired for this game")
        print("Try a more recent game (livestats purges after ~3 weeks)")
        return

    payload = resp.json()
    frames = payload.get("frames", [])
    meta = payload.get("gameMetadata", {})

    # Parse participants
    blue_meta = meta.get("blueTeamMetadata", {}).get("participantMetadata", [])
    red_meta = meta.get("redTeamMetadata", {}).get("participantMetadata", [])

    participants = {}
    blue_pids = set()
    red_pids = set()
    for p in blue_meta:
        pid = str(p["participantId"])
        participants[pid] = {"name": p.get("summonerName", "?"), "champion": p.get("championId", "?"), "side": "blue"}
        blue_pids.add(pid)
    for p in red_meta:
        pid = str(p["participantId"])
        participants[pid] = {"name": p.get("summonerName", "?"), "champion": p.get("championId", "?"), "side": "red"}
        red_pids.add(pid)

    print("BLUE team:")
    for pid in sorted(blue_pids):
        p = participants[pid]
        print(f"  P{pid}: {p['name']:>12} ({p['champion']})")
    print("RED team:")
    for pid in sorted(red_pids):
        p = participants[pid]
        print(f"  P{pid}: {p['name']:>12} ({p['champion']})")

    # Walk all frames
    anchor_ts = frames[0].get("rfc460Timestamp", "")
    anchor_dt = datetime.fromisoformat(anchor_ts.replace("Z", "+00:00"))
    print(f"\nAnchor: {anchor_ts}")

    header = f"{'Time':>8} | {'Killer':>15} -> {'Victim':<15} | {'Assists':<40} | Classification"
    print()
    print(header)
    print("=" * 120)

    prev_kda = {}
    total_solo = 0
    total_with_assists = 0
    all_kills_data = []
    t = 0

    consecutive_empty = 0
    while t < 3600:  # max 60 min
        query_dt = anchor_dt + timedelta(seconds=t)
        ts_str = query_dt.strftime("%Y-%m-%dT%H:%M:%S") + ".000Z"

        try:
            resp = httpx.get(f"{FEED}/window/{ext_id}", params={"startingTime": ts_str}, timeout=10)
        except Exception:
            t += 100
            continue
        if resp.status_code == 204:
            consecutive_empty += 1
            if consecutive_empty > 5:
                break
            t += 100
            continue
        if resp.status_code != 200:
            t += 100
            continue

        new_frames = resp.json().get("frames", [])
        if not new_frames:
            consecutive_empty += 1
            if consecutive_empty > 5:
                break
            t += 100
            continue
        consecutive_empty = 0

        for frame in new_frames:
            curr_kda = {}
            # Participants are under blueTeam/redTeam, not directly on frame
            for team_key in ("blueTeam", "redTeam"):
                team_data = frame.get(team_key, {})
                for p in team_data.get("participants", []):
                    pid = str(p["participantId"])
                    curr_kda[pid] = {
                        "kills": p.get("kills", 0),
                        "deaths": p.get("deaths", 0),
                        "assists": p.get("assists", 0),
                    }

            if prev_kda:
                killers = []
                victims = []
                assistants = []

                for pid in curr_kda:
                    prev = prev_kda.get(pid, {"kills": 0, "deaths": 0, "assists": 0})
                    dk = curr_kda[pid]["kills"] - prev["kills"]
                    dd = curr_kda[pid]["deaths"] - prev["deaths"]
                    da = curr_kda[pid]["assists"] - prev["assists"]
                    info = participants.get(pid, {"name": f"P{pid}", "champion": "?", "side": "?"})

                    if dk > 0:
                        killers.append({"pid": pid, "dk": dk, **info})
                    if dd > 0:
                        victims.append({"pid": pid, **info})
                    if da > 0:
                        assistants.append({"pid": pid, "da": da, **info})

                if killers:
                    frame_ts_str = frame.get("rfc460Timestamp", "")
                    if frame_ts_str:
                        frame_dt = datetime.fromisoformat(frame_ts_str.replace("Z", "+00:00"))
                        game_seconds = int((frame_dt - anchor_dt).total_seconds())
                    else:
                        game_seconds = t

                    for killer in killers:
                        # Find victim(s) on opposite side
                        opp_victims = [v for v in victims if v["side"] != killer["side"]]
                        victim = opp_victims[0] if opp_victims else {"name": "?", "champion": "?"}

                        # Find assistants: same side as killer, NOT the killer
                        kill_assists = [
                            a for a in assistants
                            if a["side"] == killer["side"] and a["pid"] != killer["pid"]
                        ]

                        n_assists = len(kill_assists)

                        # Classification
                        concurrent_kills = len(killers)
                        if n_assists == 0 and concurrent_kills == 1:
                            classification = "SOLO KILL"
                            total_solo += 1
                        elif n_assists == 1 and concurrent_kills <= 2:
                            classification = f"PICK (2v1)"
                            total_with_assists += 1
                        elif n_assists >= 2 and concurrent_kills <= 2:
                            classification = f"GANK ({n_assists+1}v1)"
                            total_with_assists += 1
                        elif concurrent_kills <= 3:
                            classification = f"SKIRMISH ({concurrent_kills} kills)"
                            total_with_assists += 1
                        else:
                            classification = f"TEAMFIGHT ({concurrent_kills} kills)"
                            total_with_assists += 1

                        multi = ""
                        if killer["dk"] >= 5: multi = " [PENTA]"
                        elif killer["dk"] >= 4: multi = " [QUADRA]"
                        elif killer["dk"] >= 3: multi = " [TRIPLE]"
                        elif killer["dk"] >= 2: multi = " [DOUBLE]"

                        assist_str = ", ".join(f"{a['name']}({a['champion']})" for a in kill_assists) if kill_assists else "NONE"

                        killer_str = f"{killer['name']}({killer['champion']})"
                        victim_str = f"{victim['name']}({victim['champion']})"

                        gt = game_seconds
                        print(f"{gt//60:>3}:{gt%60:02d}   | {killer_str:>15} -> {victim_str:<15} | {assist_str:<40} | {classification}{multi}")

                        all_kills_data.append({
                            "game_time": game_seconds,
                            "killer": killer["name"],
                            "killer_champ": killer["champion"],
                            "victim": victim["name"],
                            "victim_champ": victim["champion"],
                            "assists": [a["name"] for a in kill_assists],
                            "n_assists": n_assists,
                            "classification": classification,
                        })

            prev_kda = curr_kda

        # Advance by a fixed step — the frame timestamps can be bunched
        # together at the start, so we use a reliable 100s stride
        t += 100
        time.sleep(0.3)

    print()
    print("=" * 120)
    print(f"TOTAL: {len(all_kills_data)} kills detected")
    print(f"  True solo kills (0 assists): {total_solo}")
    print(f"  Kills with assists: {total_with_assists}")
    print(f"  Solo kill rate: {total_solo*100/max(1,len(all_kills_data)):.0f}%")

    # Save for analysis
    with open("assist_validation.json", "w") as f:
        json.dump(all_kills_data, f, indent=2, ensure_ascii=False)
    print(f"\nSaved to assist_validation.json")


if __name__ == "__main__":
    main()
