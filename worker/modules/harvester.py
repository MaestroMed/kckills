"""
HARVESTER — Kill detection by diffing consecutive livestats frames.

Algorithm:
- Fetch frames at ~10s intervals for a completed game via
  feed.lolesports.com/livestats/v1/window/{game_id}
- Diff frame N vs N+1: detect KDA changes
- Case 1 (70%): 1 killer +1K, 1 victim +1D, opposite sides → high confidence
- Case 2 (teamfights): N killers, M victims → correlate by side → medium confidence
- Multi-kill: +N kills on one player in a single frame
- First blood: totalKills goes from 0 to 1

Output is a list of KillEvent dataclasses that the orchestrator turns into
`kills` rows. Exposes both a low-level `extract_kills_from_game` (used by
the pipeline orchestrator) and a daemon-friendly `run()` that scans the DB
for any games in state 'vod_found' whose kills have not been extracted yet.
"""

from __future__ import annotations

import structlog
from datetime import datetime, timedelta

from config import config
from models.kill_event import KillEvent
from services import livestats_api
from services.supabase_client import safe_select, safe_update, safe_insert

log = structlog.get_logger()


# ─── Public API ─────────────────────────────────────────────────────────────

async def extract_kills_from_game(
    external_game_id: str,
    db_game_id: str,
    match_start_iso: str,
    kc_side: str | None = None,
) -> list[KillEvent]:
    """Extract all kills from a completed game by diffing frames.

    Args:
        external_game_id: Riot/lolesports game ID used by the livestats feed.
        db_game_id: The `games.id` UUID to stamp on each KillEvent so they
            can be inserted with the correct FK.
        match_start_iso: RFC3339 string of the match scheduled start. We walk
            the window endpoint starting from +15 min to +90 min.
        kc_side: 'blue' or 'red' if already known. Otherwise detected from
            the first successful window response.
    """
    kills: list[KillEvent] = []

    try:
        start = datetime.fromisoformat(match_start_iso.replace("Z", "+00:00"))
    except Exception:
        log.error("harvester_bad_match_start", start=match_start_iso)
        return []

    prev_kda: dict[str, dict] | None = None
    participants: dict[str, dict] = {}
    game_start_epoch_ms: int | None = None
    total_kills_seen = 0

    # Step through 3-minute windows from +15 to +90 min
    for offset_min in range(15, 95, 3):
        t = start + timedelta(minutes=offset_min)
        ts = t.strftime("%Y-%m-%dT%H:%M:%S.000Z")

        data = await livestats_api.get_window(external_game_id, ts)
        if not data:
            continue

        frames = data.get("frames", [])
        if not frames:
            continue

        # First successful fetch: pull participant metadata + infer kc_side
        if not participants:
            participants = livestats_api.extract_participants(data)
            if kc_side is None:
                kc_side = _detect_kc_side(participants)
            log.info(
                "harvester_participants_loaded",
                game_id=external_game_id,
                kc_side=kc_side,
                n=len(participants),
            )

        for frame in frames:
            curr_kda = livestats_api.extract_kda(frame)
            frame_ts = frame.get("rfc460Timestamp", ts)
            frame_epoch = _parse_epoch_ms(frame_ts)

            if game_start_epoch_ms is None and any(v.get("kills", 0) > 0 or v.get("gold", 0) > 600 for v in curr_kda.values()):
                # First frame where game is ongoing — not perfect but good enough
                # to compute game_time_seconds relative to this anchor.
                game_start_epoch_ms = frame_epoch

            if prev_kda is not None and kc_side is not None:
                new_kills = _diff_frames(
                    prev_kda,
                    curr_kda,
                    participants,
                    frame_ts,
                    db_game_id,
                    kc_side,
                    total_kills_seen,
                )
                for k in new_kills:
                    # Stamp game_time_seconds relative to first "active" frame
                    if game_start_epoch_ms and k.event_epoch:
                        k.game_time_seconds = max(0, (k.event_epoch - game_start_epoch_ms) // 1000)
                    kills.append(k)
                total_kills_seen += len(new_kills)

            prev_kda = curr_kda

    log.info(
        "kills_extracted",
        external_game_id=external_game_id,
        count=len(kills),
        kc_side=kc_side,
    )
    return kills


def _detect_kc_side(participants: dict[str, dict]) -> str | None:
    """Guess KC's side by looking for 'KC ' prefix in summoner names."""
    blue_names = [p.get("name", "") for p in participants.values() if p.get("side") == "blue"]
    red_names = [p.get("name", "") for p in participants.values() if p.get("side") == "red"]

    def has_kc_prefix(names: list[str]) -> bool:
        return any(n.upper().startswith("KC ") or n.upper().startswith("KC") and len(n) > 2 and n[2].isupper() for n in names)

    if has_kc_prefix(blue_names):
        return "blue"
    if has_kc_prefix(red_names):
        return "red"
    return None


def _parse_epoch_ms(ts: str) -> int:
    try:
        return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return 0


# ─── Frame diff algorithm ───────────────────────────────────────────────────

def _diff_frames(
    prev: dict[str, dict],
    curr: dict[str, dict],
    participants: dict[str, dict],
    frame_ts: str,
    db_game_id: str,
    kc_side: str,
    total_kills_before: int,
) -> list[KillEvent]:
    """Compare two consecutive frames and detect kills."""
    kills: list[KillEvent] = []

    new_killers: list[tuple[str, int]] = []
    new_victims: list[tuple[str, int]] = []

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

    epoch = _parse_epoch_ms(frame_ts)

    # ─── Case 1: simple 1v1 ────────────────────────────────────────────
    if len(new_killers) == 1 and len(new_victims) == 1:
        killer_pid, dk = new_killers[0]
        victim_pid, _dd = new_victims[0]
        killer_info = participants.get(killer_pid, {})
        victim_info = participants.get(victim_pid, {})

        if killer_info.get("side") != victim_info.get("side"):
            kc_involvement = _get_kc_involvement(killer_info, victim_info, kc_side)
            if not kc_involvement:
                return []

            kills.append(KillEvent(
                game_id=db_game_id,
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
                is_first_blood=(total_kills_before == 0),
                multi_kill=_detect_multi_kill(dk),
            ))
            return kills

    # ─── Case 2: teamfight (correlate by opposite sides) ───────────────
    blue_killers = [(pid, dk) for pid, dk in new_killers if participants.get(pid, {}).get("side") == "blue"]
    red_killers = [(pid, dk) for pid, dk in new_killers if participants.get(pid, {}).get("side") == "red"]
    blue_victims = [pid for pid, _ in new_victims if participants.get(pid, {}).get("side") == "blue"]
    red_victims = [pid for pid, _ in new_victims if participants.get(pid, {}).get("side") == "red"]

    used_victims: set[str] = set()

    for killer_pid, dk in blue_killers:
        killer_info = participants.get(killer_pid, {})
        for victim_pid in red_victims:
            if victim_pid in used_victims:
                continue
            victim_info = participants.get(victim_pid, {})
            kc_inv = _get_kc_involvement(killer_info, victim_info, kc_side)
            if not kc_inv:
                continue
            kills.append(KillEvent(
                game_id=db_game_id,
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
                tracked_team_involvement=kc_inv,
                is_first_blood=(total_kills_before == 0 and len(kills) == 0),
                multi_kill=_detect_multi_kill(dk),
            ))
            used_victims.add(victim_pid)
            break

    for killer_pid, dk in red_killers:
        killer_info = participants.get(killer_pid, {})
        for victim_pid in blue_victims:
            if victim_pid in used_victims:
                continue
            victim_info = participants.get(victim_pid, {})
            kc_inv = _get_kc_involvement(killer_info, victim_info, kc_side)
            if not kc_inv:
                continue
            kills.append(KillEvent(
                game_id=db_game_id,
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
                tracked_team_involvement=kc_inv,
                is_first_blood=(total_kills_before == 0 and len(kills) == 0),
                multi_kill=_detect_multi_kill(dk),
            ))
            used_victims.add(victim_pid)
            break

    return kills


def _get_kc_involvement(killer_info: dict, victim_info: dict, kc_side: str) -> str | None:
    """Determine KC's involvement. Returns None if KC not involved."""
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


# ─── Daemon loop ────────────────────────────────────────────────────────────

async def run() -> int:
    """Scan games in 'vod_found' state and extract kills. Returns kill count."""
    log.info("harvester_scan_start")

    # Games where kills haven't been extracted yet
    games = safe_select(
        "games",
        "id, external_id, match_id, kills_extracted, state",
        kills_extracted=False,
    )

    total_kills = 0
    for game in games:
        if game.get("kills_extracted"):
            continue
        if game.get("state") not in ("vod_found", "pending", "completed"):
            continue

        match_id = game.get("match_id")
        if not match_id:
            continue

        matches = safe_select("matches", "external_id, scheduled_at", id=match_id)
        if not matches:
            continue

        match_start = matches[0].get("scheduled_at") or ""
        if not match_start:
            continue

        kills = await extract_kills_from_game(
            external_game_id=game["external_id"],
            db_game_id=game["id"],
            match_start_iso=match_start,
        )

        for k in kills:
            safe_insert("kills", k.to_db_dict())
            total_kills += 1

        safe_update("games", {"kills_extracted": True}, "id", game["id"])

    log.info("harvester_scan_done", games_processed=len(games), kills_inserted=total_kills)
    return total_kills
