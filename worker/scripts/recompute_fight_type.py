"""
RECOMPUTE — fight_type + matchup_lane + lane_phase from ground-truth data.

Gemini's vision-based fight_type guess is unreliable on 720p clips:
  - 89 kills tagged 'solo_kill' have another kill within 12s (clearly a fight)
  - 36 kills tagged 'teamfight_5v5' have no other kills nearby (isolated solo)

The fix: classify deterministically server-side from data we already have.

Algorithm
---------
For each published kill K at game_time T (game_id G):
  W = kills in G with game_time within [T-12s, T+12s], including K
  total = len(W)
  same_side_assists = max(0, total - 1) on K's team direction

  if total == 1:                          fight_type = solo_kill
  elif total == 2:                         skirmish_2v2 (or gank if asymmetric)
  elif total == 3:                         skirmish_3v3
  elif total in (4, 5):                    teamfight_4v4
  elif total >= 6:                         teamfight_5v5

  Override: if multi_kill is set on K, anchor to solo_kill or gank
    (one player took down N enemies — the fight was their show).

matchup_lane comes from killer + victim role (we know roles via player_id
join → players.role). Cross-map when roles differ AND time > 14min.

lane_phase is purely time-based (already computed by analyzer
post-Gemini, but we re-validate here):
  < 14min : early
  14-26min: mid
  >= 26min: late

Idempotent. Safe to re-run after every match.

USAGE
    cd worker
    python scripts/recompute_fight_type.py --dry-run
    python scripts/recompute_fight_type.py
    python scripts/recompute_fight_type.py --only-fight-type   # skip lane recompute
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from services.supabase_client import safe_select, safe_update  # noqa: E402

# ─── Tuning constants ──────────────────────────────────────────────────────

CONCURRENT_WINDOW_S = 12   # kills within ±12s of K count toward the same fight

# Player role mapping for matchup_lane recompute. We pull from `players`
# table. Roles already normalized: top|jungle|mid|bottom|support.
ROLE_TO_LANE = {
    "top": "top",
    "jungle": "jungle",
    "mid": "mid",
    "bottom": "bot",
    "adc": "bot",
    "support": "support",
}


def classify_fight(total_in_window: int, multi_kill: str | None) -> str:
    """Map concurrency-window cardinality + multi-kill flag to fight_type."""
    # Multi-kill anchor: one player took several enemies down - this is
    # someone's solo carry moment regardless of how many bodies fell.
    # Penta is a special case: very often happens during a teamfight.
    if multi_kill:
        mk = multi_kill.lower()
        if mk in {"triple", "quadra"}:
            return "solo_kill"
        if mk == "penta":
            # If concurrent window is dense, it WAS a teamfight that the
            # carry cleaned up. Otherwise treat as a solo_kill stomp.
            return "teamfight_5v5" if total_in_window >= 5 else "solo_kill"
        # double_kill: ambiguous, treat by window
    if total_in_window <= 1:
        return "solo_kill"
    if total_in_window == 2:
        return "skirmish_2v2"
    if total_in_window == 3:
        return "skirmish_3v3"
    if total_in_window in (4, 5):
        return "teamfight_4v4"
    return "teamfight_5v5"


def lane_phase_for(seconds: int | None) -> str | None:
    if seconds is None:
        return None
    if seconds < 14 * 60:
        return "early"
    if seconds < 26 * 60:
        return "mid"
    return "late"


def matchup_for(killer_role: str | None, victim_role: str | None, seconds: int | None) -> str | None:
    """Lane matchup classification.

    Same role -> that role. Different roles in early game -> still pin
    to the victim's lane (they got picked off in their lane). Different
    roles in mid/late game -> cross_map (rotation kill).
    """
    k = ROLE_TO_LANE.get((killer_role or "").lower())
    v = ROLE_TO_LANE.get((victim_role or "").lower())
    if not v:
        return None
    if k == v or seconds is None:
        return v
    if seconds < 14 * 60:
        return v
    return "cross_map"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--only-fight-type", action="store_true",
                        help="skip matchup_lane + lane_phase recompute")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    print("-> loading published kills + their game_id, time, multi_kill, roles")
    kills = safe_select(
        "kills",
        "id, game_id, game_time_seconds, multi_kill, fight_type, "
        "matchup_lane, lane_phase, killer_player_id, victim_player_id",
        status="published",
    ) or []
    if args.limit:
        kills = kills[: args.limit]
    print(f"   {len(kills)} kills considered")

    # Player UUID -> role lookup (one query, cached locally).
    players = safe_select("players", "id, ign, role") or []
    role_by_id = {p["id"]: p.get("role") for p in players}
    print(f"   {len(role_by_id)} players in role lookup")

    # Group kills by game so the concurrency window is cheap.
    by_game: dict[str, list[dict]] = defaultdict(list)
    for k in kills:
        by_game[k.get("game_id") or ""].append(k)

    stats: dict[str, int] = defaultdict(int)
    transitions: dict[tuple[str, str], int] = defaultdict(int)
    for game_id, game_kills in by_game.items():
        sorted_kills = sorted(game_kills, key=lambda x: x.get("game_time_seconds") or 0)
        for k in sorted_kills:
            t = k.get("game_time_seconds") or 0
            window = [
                o for o in sorted_kills
                if abs((o.get("game_time_seconds") or 0) - t) <= CONCURRENT_WINDOW_S
            ]
            new_ft = classify_fight(len(window), k.get("multi_kill"))
            old_ft = k.get("fight_type") or "NULL"
            transitions[(old_ft, new_ft)] += 1

            patch: dict[str, str] = {}
            if new_ft != k.get("fight_type"):
                patch["fight_type"] = new_ft

            if not args.only_fight_type:
                k_role = role_by_id.get(k.get("killer_player_id") or "") if k.get("killer_player_id") else None
                v_role = role_by_id.get(k.get("victim_player_id") or "") if k.get("victim_player_id") else None
                new_lane = matchup_for(k_role, v_role, t)
                if new_lane and new_lane != k.get("matchup_lane"):
                    patch["matchup_lane"] = new_lane
                new_phase = lane_phase_for(t)
                if new_phase and new_phase != k.get("lane_phase"):
                    patch["lane_phase"] = new_phase

            if not patch:
                stats["unchanged"] += 1
                continue

            if args.dry_run:
                stats["would_update"] += 1
                if stats["would_update"] <= 5:
                    print(f"   [dry] {k['id'][:8]} t={t}s window={len(window)} {old_ft} -> {patch}")
                continue

            safe_update("kills", patch, "id", k["id"])
            stats["updated"] += 1

    print()
    print("-" * 60)
    print("RECOMPUTE SUMMARY")
    print("-" * 60)
    for kk in sorted(stats.keys()):
        print(f"   {kk:30s} {stats[kk]}")
    print()
    print("--- fight_type transitions (old -> new : count) ---")
    for (old, new), n in sorted(transitions.items(), key=lambda x: -x[1]):
        marker = "  " if old == new else "->"
        print(f"   {marker} {old:<20s} -> {new:<20s} : {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
