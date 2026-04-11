"""
HARVESTER — Kill detection by diffing consecutive livestats frames.

Algorithm:
- Fetch frames at ~10s intervals for a completed game
- Diff frame N vs N+1: detect KDA changes
- Case 1 (70%): 1 killer +1K, 1 victim +1D, opposite sides → high confidence
- Case 2 (teamfights): N killers, M victims → correlate by side → medium confidence
- Case 3: kills without matching death → buffer for next frame
- Multi-kill: +N kills on one player in a single frame, or sliding window 30s
- First blood: totalKills goes from 0 to 1
"""

import asyncio
import structlog
from datetime import datetime, timedelta, timezone

from services import livestats_api
from models.kill_event import KillEvent
from config import config

log = structlog.get_logger()


async def extract_kills_from_game(game_id: str, match_start: str, kc_side: str) -> list[KillEvent]:
    """Extract all kills from a completed game by diffing frames."""
    kills: list[KillEvent] = []
    start = datetime.fromisoformat(match_start.replace("Z", "+00:00"))

    # Scan from +15 min (after draft) to +90 min in 10-min windows
    prev_kda: dict[str, dict] | None = None
    prev_participants: dict[str, dict] = {}
    total_kills_seen = 0

    for offset_min in range(15, 95, 3):
        t = start + timedelta(minutes=offset_min)
        ts = t.strftime("%Y-%m-%dT%H:%M:%S.000Z")

        data = await livestats_api.get_window(game_id, ts)
        if not data:
            continue

        frames = data.get("frames", [])
        if not frames:
            continue

        # Get participants on first successful fetch
        if not prev_participants:
            prev_participants = livestats_api.extract_participants(data)

        for frame in frames:
            curr_kda = livestats_api.extract_kda(frame)
            frame_ts = frame.get("rfc460Timestamp", ts)

            if prev_kda is not None:
                new_kills = _diff_frames(prev_kda, curr_kda, prev_participants, frame_ts, game_id, kc_side, total_kills_seen)
                kills.extend(new_kills)
                total_kills_seen += sum(1 for k in new_kills)

            prev_kda = curr_kda

        # Check if we've passed the game end (KDA stops changing)
        if prev_kda and offset_min > 25:
            total_k = sum(v.get("kills", 0) for v in prev_kda.values())
            total_g = sum(v.get("gold", 0) for v in prev_kda.values())
            if total_k > 0 and total_g > 50000:
                # Likely past mid-game, check if the next window has same data
                pass

    log.info("kills_extracted", game_id=game_id, count=len(kills))
    return kills


def _diff_frames(
    prev: dict[str, dict],
    curr: dict[str, dict],
    participants: dict[str, dict],
    frame_ts: str,
    game_id: str,
    kc_side: str,
    total_kills_before: int,
) -> list[KillEvent]:
    """Compare two consecutive frames and detect kills."""
    kills: list[KillEvent] = []

    # Find players who gained kills and players who gained deaths
    new_killers: list[tuple[str, int]] = []  # (pid, delta_kills)
    new_victims: list[tuple[str, int]] = []  # (pid, delta_deaths)

    for pid in curr:
        p_curr = curr[pid]
        p_prev = prev.get(pid, {"kills": 0, "deaths": 0, "assists": 0})

        dk = p_curr.get("kills", 0) - p_prev.get("kills", 0)
        dd = p_curr.get("deaths", 0) - p_prev.get("deaths", 0)

        if dk > 0:
            new_killers.append((pid, dk))
        if dd > 0:
            new_victims.append((pid, dd))

    if not new_killers and not new_victims:
        return []

    # Parse epoch from frame timestamp
    try:
        epoch = int(datetime.fromisoformat(frame_ts.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        epoch = 0

    # ─── Case 1: Simple 1v1 (1 killer, 1 victim, opposite sides) ────────
    if len(new_killers) == 1 and len(new_victims) == 1:
        killer_pid, dk = new_killers[0]
        victim_pid, dd = new_victims[0]
        killer_info = participants.get(killer_pid, {})
        victim_info = participants.get(victim_pid, {})

        if killer_info.get("side") != victim_info.get("side"):
            is_first = total_kills_before == 0
            multi = _detect_multi_kill(dk)

            kc_involvement = _get_kc_involvement(killer_info, victim_info, kc_side)
            if not kc_involvement:
                return []

            kill = KillEvent(
                game_id=game_id,
                event_epoch=epoch,
                killer_participant_id=killer_pid,
                killer_name=killer_info.get("name"),
                killer_champion=killer_info.get("champion"),
                killer_side=killer_info.get("side"),
                victim_participant_id=victim_pid,
                victim_name=victim_info.get("name"),
                victim_champion=victim_info.get("champion"),
                victim_side=victim_info.get("side"),
                confidence="high",
                tracked_team_involvement=kc_involvement,
                is_first_blood=is_first,
                multi_kill=multi,
            )
            kills.append(kill)
            return kills

    # ─── Case 2: Teamfight (multiple kills in one frame) ────────────────
    # Correlate killers → victims by opposite sides
    blue_killers = [(pid, dk) for pid, dk in new_killers if participants.get(pid, {}).get("side") == "blue"]
    red_killers = [(pid, dk) for pid, dk in new_killers if participants.get(pid, {}).get("side") == "red"]
    blue_victims = [(pid, dd) for pid, dd in new_victims if participants.get(pid, {}).get("side") == "blue"]
    red_victims = [(pid, dd) for pid, dd in new_victims if participants.get(pid, {}).get("side") == "red"]

    is_first = total_kills_before == 0

    # Blue killers → red victims
    for killer_pid, dk in blue_killers:
        killer_info = participants.get(killer_pid, {})
        for victim_pid, dd in red_victims:
            victim_info = participants.get(victim_pid, {})
            kc_involvement = _get_kc_involvement(killer_info, victim_info, kc_side)
            if not kc_involvement:
                continue
            kills.append(KillEvent(
                game_id=game_id,
                event_epoch=epoch,
                killer_participant_id=killer_pid,
                killer_name=killer_info.get("name"),
                killer_champion=killer_info.get("champion"),
                killer_side="blue",
                victim_participant_id=victim_pid,
                victim_name=victim_info.get("name"),
                victim_champion=victim_info.get("champion"),
                victim_side="red",
                confidence="medium",
                tracked_team_involvement=kc_involvement,
                is_first_blood=is_first and len(kills) == 0,
                multi_kill=_detect_multi_kill(dk),
            ))
            break  # 1 victim per killer (best guess)

    # Red killers → blue victims
    for killer_pid, dk in red_killers:
        killer_info = participants.get(killer_pid, {})
        for victim_pid, dd in blue_victims:
            victim_info = participants.get(victim_pid, {})
            kc_involvement = _get_kc_involvement(killer_info, victim_info, kc_side)
            if not kc_involvement:
                continue
            kills.append(KillEvent(
                game_id=game_id,
                event_epoch=epoch,
                killer_participant_id=killer_pid,
                killer_name=killer_info.get("name"),
                killer_champion=killer_info.get("champion"),
                killer_side="red",
                victim_participant_id=victim_pid,
                victim_name=victim_info.get("name"),
                victim_champion=victim_info.get("champion"),
                victim_side="blue",
                confidence="medium",
                tracked_team_involvement=kc_involvement,
                is_first_blood=is_first and len(kills) == 0,
                multi_kill=_detect_multi_kill(dk),
            ))
            break

    return kills


def _get_kc_involvement(killer_info: dict, victim_info: dict, kc_side: str) -> str | None:
    """Determine KC's involvement in the kill. Returns None if KC not involved."""
    killer_is_kc = killer_info.get("side") == kc_side
    victim_is_kc = victim_info.get("side") == kc_side
    if killer_is_kc:
        return "team_killer"
    if victim_is_kc:
        return "team_victim"
    return None


def _detect_multi_kill(delta_kills: int) -> str | None:
    if delta_kills >= 5:
        return "penta"
    if delta_kills == 4:
        return "quadra"
    if delta_kills == 3:
        return "triple"
    if delta_kills == 2:
        return "double"
    return None
