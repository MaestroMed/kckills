"""
import_oracles_elixir.py
────────────────────────
Importe les données de kills KC depuis Oracle's Elixir
(le meilleur dataset public pour les données LEC).

Source : https://oracleselixir.com/tools/downloads
Fichier : 2026_LoL_esports_match_data_from_OraclesElixir.csv

Usage :
    python scripts/import_oracles_elixir.py --file 2026_LoL_esports_match_data_from_OraclesElixir.csv

Ce script extrait :
- Tous les matchs KC (LEC 2026)
- Stats par joueur par game (KDA, champions)
- Génère un JSON prêt à utiliser dans l'app
"""

import csv
import json
import sys
import argparse
from pathlib import Path
from collections import defaultdict
from datetime import datetime


KC_NAMES = {"Karmine Corp", "KC", "karmine corp"}

ROLE_MAP = {
    "top": "top",
    "jng": "jungle",
    "jungle": "jungle",
    "mid": "mid",
    "bot": "adc",
    "adc": "adc",
    "sup": "support",
    "support": "support",
}


def parse_csv(filepath: str) -> dict:
    """Parse Oracle's Elixir CSV and extract KC data."""
    matches = defaultdict(lambda: {"games": defaultdict(dict), "meta": {}})
    players_seen = {}

    with open(filepath, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    kc_rows = [r for r in rows if r.get("teamname", "") in KC_NAMES or r.get("team", "") in KC_NAMES]
    print(f"📊 {len(rows)} rows total, {len(kc_rows)} rows KC")

    for row in kc_rows:
        game_id = row.get("gameid", "")
        match_id = row.get("matchid", game_id)
        date_str = row.get("date", "")
        league = row.get("league", "LEC")
        split = row.get("split", "")
        player = row.get("playername", "")
        position = ROLE_MAP.get(row.get("position", "").lower(), row.get("position", ""))
        champion = row.get("champion", "")
        kills = int(row.get("kills", 0) or 0)
        deaths = int(row.get("deaths", 0) or 0)
        assists = int(row.get("assists", 0) or 0)
        team = row.get("teamname", row.get("team", "KC"))
        opponent = row.get("opponent", "")
        result = int(row.get("result", 0) or 0)
        game_len = int(row.get("gamelength", 0) or 0)
        patch = row.get("patch", "")
        side = row.get("side", "").lower()

        # Track players
        if player and player not in players_seen:
            players_seen[player] = {
                "summoner_name": player,
                "slug": player.lower().replace(" ", "-"),
                "role": position,
                "team": "KC" if team in KC_NAMES else team,
            }

        # Game metadata (from first row of each game)
        if game_id and game_id not in matches[match_id]["games"]:
            matches[match_id]["games"][game_id] = {
                "game_id": game_id,
                "date": date_str,
                "league": league,
                "split": split,
                "patch": patch,
                "duration": game_len,
                "kc_side": side,
                "kc_won": result == 1,
                "participants": [],
            }
            matches[match_id]["meta"] = {
                "match_id": match_id,
                "date": date_str,
                "league": league,
                "split": split,
                "opponent": opponent,
            }

        # Add participant
        if player and game_id:
            matches[match_id]["games"][game_id]["participants"].append({
                "player": player,
                "position": position,
                "champion": champion,
                "kills": kills,
                "deaths": deaths,
                "assists": assists,
                "is_kc": team in KC_NAMES,
            })

    # Build output
    output = {
        "generated_at": datetime.now().isoformat(),
        "source": "Oracle's Elixir",
        "players": list(players_seen.values()),
        "matches": [],
    }

    for match_id, match_data in matches.items():
        match_out = {
            **match_data["meta"],
            "games": [],
        }
        for game_id, game in match_data["games"].items():
            kc_participants = [p for p in game["participants"] if p["is_kc"]]
            opp_participants = [p for p in game["participants"] if not p["is_kc"]]

            match_out["games"].append({
                **game,
                "kc_kills_total": sum(p["kills"] for p in kc_participants),
                "kc_deaths_total": sum(p["deaths"] for p in kc_participants),
            })
        output["matches"].append(match_out)

    return output


def main():
    parser = argparse.ArgumentParser(description="Import Oracle's Elixir data")
    parser.add_argument("--file", required=True, help="Path to Oracle's Elixir CSV")
    parser.add_argument("--out", default="data/kc_lec_2026.json", help="Output JSON file")
    args = parser.parse_args()

    filepath = args.file
    if not Path(filepath).exists():
        print(f"❌ Fichier introuvable : {filepath}")
        print("\n💡 Télécharge le dataset sur : https://oracleselixir.com/tools/downloads")
        print("   Cherche '2026 LoL Esports Match Data'")
        sys.exit(1)

    print(f"\n📂 Import : {filepath}")
    data = parse_csv(filepath)

    out_path = Path(args.out)
    out_path.parent.mkdir(exist_ok=True, parents=True)
    out_path.write_text(json.dumps(data, indent=2, ensure_ascii=False))

    print(f"\n✅ {len(data['matches'])} matchs KC exportés")
    print(f"✅ {len(data['players'])} joueurs détectés")
    print(f"✅ Fichier : {out_path}")
    print(f"\n💡 Prochaine étape : python scripts/add_youtube_vod.py")


if __name__ == "__main__":
    main()
