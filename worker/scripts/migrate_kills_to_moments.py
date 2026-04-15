"""Migrate existing published kills into moments.

Groups kills within 30s into moments, creates moment rows, updates kills.moment_id.
For single-kill moments, copies clip URLs to the moment.
For multi-kill moments, uses the best kill's clip (needs re-clip later).

Usage:
    cd worker && python scripts/migrate_kills_to_moments.py
"""

from __future__ import annotations

import sys
import os

# Add parent dir to path so we can import worker modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from services.supabase_client import safe_select, safe_insert, safe_update
from models.moment_event import group_kills_into_moments, MomentEvent
from models.kill_event import KillEvent


def main():
    print("=== Migrating existing kills to moments ===\n")

    # 1. Fetch all published kills
    kills_data = safe_select(
        "kills",
        "id, game_id, game_time_seconds, killer_champion, victim_champion, "
        "tracked_team_involvement, is_first_blood, "
        "multi_kill, confidence, event_epoch, shutdown_bounty, "
        "clip_url_horizontal, clip_url_vertical, clip_url_vertical_low, "
        "thumbnail_url, highlight_score, ai_tags, ai_description, "
        "avg_rating, rating_count, moment_id",
        status="published",
    )

    # Skip kills that already have a moment_id
    kills_without_moment = [k for k in kills_data if not k.get("moment_id")]
    print(f"Total published kills: {len(kills_data)}")
    print(f"Already in moments: {len(kills_data) - len(kills_without_moment)}")
    print(f"Need migration: {len(kills_without_moment)}")

    if not kills_without_moment:
        print("Nothing to migrate!")
        return

    # 2. Group by game
    by_game: dict[str, list[dict]] = {}
    for k in kills_without_moment:
        by_game.setdefault(k["game_id"], []).append(k)

    print(f"Games to process: {len(by_game)}\n")

    total_moments = 0
    total_single = 0
    total_multi = 0

    for game_id, game_kills in by_game.items():
        # Sort by game time
        game_kills.sort(key=lambda k: k.get("game_time_seconds", 0))

        # Group using 30s window
        clusters: list[list[dict]] = []
        current: list[dict] = [game_kills[0]]

        for k in game_kills[1:]:
            last_t = current[-1].get("game_time_seconds", 0)
            this_t = k.get("game_time_seconds", 0)
            if this_t - last_t <= 30:
                current.append(k)
            else:
                clusters.append(current)
                current = [k]
        clusters.append(current)

        for cluster in clusters:
            # Classify the moment
            n_kills = len(cluster)
            # We don't have killer_side/victim_side in the DB schema.
            # Approximate: team_killer = KC got the kill, team_victim = KC died.
            # For blue/red counting, we just use kill_count split by involvement.
            kc_kills_in_cluster = sum(1 for k in cluster if k.get("tracked_team_involvement") == "team_killer")
            kc_deaths_in_cluster = sum(1 for k in cluster if k.get("tracked_team_involvement") == "team_victim")
            blue_kills = kc_kills_in_cluster  # approximate: KC kills = one side
            red_kills = n_kills - blue_kills  # opponent kills

            # Unique participants (champions)
            participants = set()
            for k in cluster:
                if k.get("killer_champion"):
                    participants.add(k["killer_champion"])
                if k.get("victim_champion"):
                    participants.add(k["victim_champion"])
            blue_deaths = kc_deaths_in_cluster
            red_deaths = n_kills - kc_deaths_in_cluster

            # Classification
            if blue_deaths >= 5 or red_deaths >= 5:
                classification = "ace"
            elif n_kills >= 4 or len(participants) >= 7:
                classification = "teamfight"
            elif n_kills >= 2:
                classification = "skirmish"
            else:
                classification = "solo_kill"

            # KC involvement
            kc_kills = sum(1 for k in cluster if k.get("tracked_team_involvement") == "team_killer")
            kc_deaths = sum(1 for k in cluster if k.get("tracked_team_involvement") == "team_victim")
            if kc_kills > 0 and kc_deaths > 0:
                kc_inv = "kc_both"
            elif kc_kills > 0:
                kc_inv = "kc_aggressor"
            elif kc_deaths > 0:
                kc_inv = "kc_victim"
            else:
                kc_inv = "kc_none"

            # Winning side
            if blue_kills > red_kills:
                winning = "blue"
            elif red_kills > blue_kills:
                winning = "red"
            else:
                winning = None

            start_t = cluster[0].get("game_time_seconds", 0)
            end_t = cluster[-1].get("game_time_seconds", 0)

            # Score: average of individual scores
            scores = [float(k.get("highlight_score") or 5.0) for k in cluster]
            avg_score = sum(scores) / len(scores) if scores else 5.0

            # Best kill (highest score) for clip URLs
            best_kill = max(cluster, key=lambda k: float(k.get("highlight_score") or 0))

            # Create moment row
            moment_payload = {
                "game_id": game_id,
                "start_time_seconds": start_t,
                "end_time_seconds": end_t,
                "classification": classification,
                "blue_kills": blue_kills,
                "red_kills": red_kills,
                "winning_side": winning,
                "kc_involvement": kc_inv,
                "kill_count": n_kills,
                "participants_involved": len(participants),
                "gold_swing": 0,  # not available for existing kills
                "moment_score": round(avg_score, 1),
                "ai_tags": best_kill.get("ai_tags") or [],
                "ai_description": best_kill.get("ai_description"),
                "avg_rating": best_kill.get("avg_rating"),
                "rating_count": best_kill.get("rating_count") or 0,
                # Use best kill's clips
                "clip_url_horizontal": best_kill.get("clip_url_horizontal"),
                "clip_url_vertical": best_kill.get("clip_url_vertical"),
                "clip_url_vertical_low": best_kill.get("clip_url_vertical_low"),
                "thumbnail_url": best_kill.get("thumbnail_url"),
                "status": "published",
            }

            moment_row = safe_insert("moments", moment_payload)
            if not moment_row:
                print(f"  ERROR inserting moment for {n_kills} kills @ {start_t//60}:{start_t%60:02d}")
                continue

            moment_id = moment_row["id"]

            # Update kills with moment_id
            for k in cluster:
                safe_update("kills", {"moment_id": moment_id}, "id", k["id"])

            total_moments += 1
            if n_kills == 1:
                total_single += 1
            else:
                total_multi += 1

        print(f"  Game {game_id[:8]}: {len(game_kills)} kills -> {len(clusters)} moments")

    print(f"\n=== Migration complete ===")
    print(f"Total moments created: {total_moments}")
    print(f"  Single-kill moments: {total_single}")
    print(f"  Multi-kill moments: {total_multi} (need re-clip for full coverage)")

    # Verify
    moments = safe_select("moments", "id, classification, kill_count", status="published")
    by_class = {}
    for m in moments:
        c = m.get("classification", "?")
        by_class[c] = by_class.get(c, 0) + 1
    print(f"\nPublished moments by classification:")
    for c, n in sorted(by_class.items()):
        print(f"  {c}: {n}")


if __name__ == "__main__":
    main()
