"""
Oracle's Elixir fallback — imports KDA data from CSV exports.
Source: https://oracleselixir.com/tools/downloads
Data is J+1 (available the day after matches).
"""

import csv
import structlog
from pathlib import Path

log = structlog.get_logger()
KC_NAMES = {"Karmine Corp", "KC"}


def parse_csv(filepath: str, team_filter: set = KC_NAMES) -> list[dict]:
    """Parse Oracle's Elixir CSV and return KC game data."""
    if not Path(filepath).exists():
        log.warn("oracles_csv_not_found", path=filepath)
        return []

    results = []
    with open(filepath, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            team = row.get("teamname", row.get("team", ""))
            if team not in team_filter:
                continue

            results.append({
                "game_id": row.get("gameid", ""),
                "date": row.get("date", ""),
                "player": row.get("playername", ""),
                "champion": row.get("champion", ""),
                "position": row.get("position", ""),
                "kills": int(row.get("kills", 0) or 0),
                "deaths": int(row.get("deaths", 0) or 0),
                "assists": int(row.get("assists", 0) or 0),
                "opponent": row.get("opponent", ""),
                "result": int(row.get("result", 0) or 0),
                "gamelength": int(row.get("gamelength", 0) or 0),
                "league": row.get("league", ""),
                "split": row.get("split", ""),
                "patch": row.get("patch", ""),
            })

    log.info("oracles_parsed", rows=len(results), file=filepath)
    return results


def get_kill_estimates(game_data: list[dict]) -> list[dict]:
    """
    Estimate individual kill events from aggregated KDA data.
    Since Oracle's Elixir doesn't have timestamps, we distribute kills uniformly.
    All kills have confidence='estimated'.
    """
    kills = []
    for player in game_data:
        for i in range(player["kills"]):
            kills.append({
                "killer_name": player["player"],
                "killer_champion": player["champion"],
                "confidence": "estimated",
                "data_source": "oracles_elixir",
                "game_id": player["game_id"],
            })
    return kills
