"""
HARVESTER — Kill detection by diffing livestats window snapshots.

Strategy (validated 2026-04-11 against the real API, see LIVESTATS_FINDINGS.md):

1. Call `/livestats/v1/window/{game_id}` WITHOUT `startingTime` to receive a
   snapshot anchored at the real game start (draft + setup excluded).
2. Parse the first frame's `rfc460Timestamp` and round it DOWN to the 10s
   boundary — the API rejects any `startingTime` whose seconds % 10 != 0
   with a 400 BAD_QUERY_PARAMETER.
3. Walk forward from that anchor in 10-second probes. Each probe returns 200
   with a 10-frame snapshot, 204 No Content, or silently nothing.
4. Diff consecutive snapshots on per-participant KDA to derive kill events.
5. Tolerate long runs of 204 (mid-game quiet periods can easily produce 30+
   consecutive empty probes); only give up after `max_consecutive_empty`
   empties in a row OR once `max_game_minutes` is reached.

`extract_kills_from_game` no longer takes a scheduled start because
`match.startTime` is the announced broadcast slot, not the real game start —
the two can differ by 30+ minutes.
"""

from __future__ import annotations

import structlog
from datetime import datetime, timedelta

from models.kill_event import KillEvent
from services import livestats_api
from services.supabase_client import safe_insert, safe_select, safe_update

log = structlog.get_logger()


# ─── Public API ─────────────────────────────────────────────────────────────

async def get_game_anchor(external_game_id: str) -> tuple[datetime, dict] | None:
    """Fetch the real game start anchor for a completed game.

    Calls /window/{game_id} without startingTime, which returns a snapshot at
    the true game-start moment (draft + setup excluded). Returns a tuple of
    (anchor_datetime_rounded_to_10s, full_livestats_response) so callers can
    reuse both the timestamp and the participant metadata.
    """
    anchor_data = await livestats_api.get_window(external_game_id, starting_time=None)
    frames = (anchor_data or {}).get("frames") or []
    if not frames:
        log.warn("harvester_no_anchor", game_id=external_game_id)
        return None

    anchor_ts_raw = frames[0].get("rfc460Timestamp")
    try:
        anchor = datetime.fromisoformat(anchor_ts_raw.replace("Z", "+00:00"))
    except Exception:
        log.error("harvester_bad_anchor_ts", ts=anchor_ts_raw, game_id=external_game_id)
        return None
    return _round_down_10s(anchor), anchor_data


async def extract_kills_from_game(
    external_game_id: str,
    db_game_id: str,
    kc_side: str | None = None,
    probe_step_seconds: int = 10,
    max_game_minutes: int = 65,
    max_consecutive_empty: int = 60,
    precomputed_anchor: tuple[datetime, dict] | None = None,
) -> list[KillEvent]:
    """Extract every kill from a completed game by diffing window snapshots.

    Args:
        external_game_id: Riot/lolesports game ID used by the livestats feed.
        db_game_id: The `games.id` UUID to stamp on each emitted KillEvent.
        kc_side: 'blue' or 'red' if already known. Otherwise inferred from the
            anchor snapshot's participant metadata.
        probe_step_seconds: Walk step between probes. Must be ≥ 10 (API grid).
        max_game_minutes: Hard cap from anchor → stop probing past this.
        max_consecutive_empty: Early-stop threshold if the feed is silent for
            this many probes in a row (10 min with default 10s step).
        precomputed_anchor: Optional (datetime, full_frame_response) tuple from
            a previous get_game_anchor call — avoids a redundant livestats hit
            when the pipeline already fetched the anchor to compute VOD offsets.
    """
    kills: list[KillEvent] = []

    # ─── Anchor: reuse a precomputed one or call without startingTime ────
    if precomputed_anchor is not None:
        anchor, anchor_data = precomputed_anchor
    else:
        got = await get_game_anchor(external_game_id)
        if got is None:
            return []
        anchor, anchor_data = got
    frames = (anchor_data or {}).get("frames") or []
    if not frames:
        log.warn("harvester_no_anchor", game_id=external_game_id)
        return []

    game_start_epoch_ms = int(anchor.timestamp() * 1000)

    participants = livestats_api.extract_participants(anchor_data)
    if kc_side is None:
        kc_side = _detect_kc_side(participants)

    log.info(
        "harvester_anchor",
        game_id=external_game_id,
        anchor=anchor.isoformat(),
        kc_side=kc_side,
        n_participants=len(participants),
    )

    # Seed prev_kda from the anchor snapshot. If the anchor already contains
    # kills (unlikely but possible on a late poll), we log so they aren't
    # silently lost.
    prev_kda = livestats_api.extract_kda(frames[-1])
    total_kills_seen = sum(v.get("kills", 0) for v in prev_kda.values())
    if total_kills_seen:
        log.warn(
            "harvester_anchor_has_kills",
            game_id=external_game_id,
            kills_lost=total_kills_seen,
        )

    # ─── Walk forward in 10-second probes ────────────────────────────────
    step = timedelta(seconds=max(probe_step_seconds, 10))
    end = anchor + timedelta(minutes=max_game_minutes)
    t = anchor + step
    consecutive_empty = 0
    probes = 0
    hits = 0

    while t < end:
        probes += 1
        ts = t.strftime("%Y-%m-%dT%H:%M:%S.000Z")
        data = await livestats_api.get_window(external_game_id, ts)
        probe_frames = (data or {}).get("frames") or []

        if not probe_frames:
            consecutive_empty += 1
            if consecutive_empty >= max_consecutive_empty:
                log.info(
                    "harvester_stop_empty_run",
                    game_id=external_game_id,
                    at=ts,
                    consecutive_empty=consecutive_empty,
                )
                break
            t += step
            continue

        consecutive_empty = 0
        hits += 1

        latest = probe_frames[-1]
        curr_kda = livestats_api.extract_kda(latest)
        frame_ts = latest.get("rfc460Timestamp", ts)

        if kc_side is not None:
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
                if k.event_epoch:
                    k.game_time_seconds = max(0, (k.event_epoch - game_start_epoch_ms) // 1000)
                kills.append(k)
            total_kills_seen += len(new_kills)

        prev_kda = curr_kda
        t += step

    log.info(
        "kills_extracted",
        external_game_id=external_game_id,
        count=len(kills),
        kc_side=kc_side,
        probes=probes,
        hits=hits,
    )
    return kills


def _round_down_10s(dt: datetime) -> datetime:
    return dt.replace(microsecond=0, second=(dt.second // 10) * 10)


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
    """Scan games whose kills haven't been extracted yet and fill them in."""
    log.info("harvester_scan_start")

    games = safe_select(
        "games",
        "id, external_id, kills_extracted, state",
        kills_extracted=False,
    )

    total_kills = 0
    for game in games:
        if game.get("kills_extracted"):
            continue
        if game.get("state") not in ("vod_found", "pending", "completed"):
            continue
        if not game.get("external_id"):
            continue

        kills = await extract_kills_from_game(
            external_game_id=game["external_id"],
            db_game_id=game["id"],
        )

        for k in kills:
            safe_insert("kills", k.to_db_dict())
            total_kills += 1

        safe_update("games", {"kills_extracted": True}, "id", game["id"])

    log.info("harvester_scan_done", games_processed=len(games), kills_inserted=total_kills)
    return total_kills
