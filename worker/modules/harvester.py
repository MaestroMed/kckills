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
from services.observability import run_logged
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


async def extract_moments_from_game(
    external_game_id: str,
    db_game_id: str,
    kc_side: str | None = None,
    probe_step_seconds: int = 10,
    max_game_minutes: int = 65,
    max_consecutive_empty: int = 60,
    precomputed_anchor: tuple | None = None,
) -> tuple[list, list, dict[int, dict[str, int]]]:
    """Extract kills and group them into moments, also tracking gold per frame.

    Returns:
        (moments, kills, gold_snapshots)
        - moments: list[MomentEvent]
        - kills: list[KillEvent] (raw kills, for DB insert with moment_id FK)
        - gold_snapshots: dict[game_seconds -> {"blue": int, "red": int}]
    """
    from models.moment_event import MomentEvent, group_kills_into_moments

    # ─── Anchor ──────────────────────────────────────────────────────────
    if precomputed_anchor is not None:
        anchor, anchor_data = precomputed_anchor
    else:
        got = await get_game_anchor(external_game_id)
        if got is None:
            return [], [], {}
        anchor, anchor_data = got

    frames = (anchor_data or {}).get("frames") or []
    if not frames:
        return [], [], {}

    game_start_epoch_ms = int(anchor.timestamp() * 1000)
    participants = livestats_api.extract_participants(anchor_data)
    if kc_side is None:
        kc_side = _detect_kc_side(participants)

    log.info(
        "harvester_moments_anchor",
        game_id=external_game_id,
        anchor=anchor.isoformat(),
        kc_side=kc_side,
    )

    # Seed from anchor
    prev_kda = livestats_api.extract_kda(frames[-1])
    total_kills_seen = sum(v.get("kills", 0) for v in prev_kda.values())
    kills: list[KillEvent] = []
    gold_snapshots: dict[int, dict[str, int]] = {}

    # Capture initial gold snapshot
    _record_gold(gold_snapshots, prev_kda, participants, 0)

    # ─── Walk forward ────────────────────────────────────────────────────
    step = timedelta(seconds=max(probe_step_seconds, 10))
    end = anchor + timedelta(minutes=max_game_minutes)
    t = anchor + step
    consecutive_empty = 0

    while t < end:
        ts = t.strftime("%Y-%m-%dT%H:%M:%S.000Z")
        data = await livestats_api.get_window(external_game_id, ts)
        probe_frames = (data or {}).get("frames") or []

        if not probe_frames:
            consecutive_empty += 1
            if consecutive_empty >= max_consecutive_empty:
                break
            t += step
            continue

        consecutive_empty = 0
        latest = probe_frames[-1]
        curr_kda = livestats_api.extract_kda(latest)
        frame_ts = latest.get("rfc460Timestamp", ts)

        # Track gold per frame
        game_seconds = max(0, (int(_parse_ts(frame_ts).timestamp() * 1000) - game_start_epoch_ms) // 1000) if frame_ts else 0
        _record_gold(gold_snapshots, curr_kda, participants, game_seconds)

        if kc_side is not None:
            new_kills = _diff_frames(
                prev_kda, curr_kda, participants, frame_ts,
                db_game_id, kc_side, total_kills_seen,
            )
            for k in new_kills:
                if k.event_epoch:
                    k.game_time_seconds = max(0, (k.event_epoch - game_start_epoch_ms) // 1000)
                kills.append(k)
            total_kills_seen += len(new_kills)

        prev_kda = curr_kda
        t += step

    # Group kills into moments
    moments = group_kills_into_moments(kills, gold_snapshots, kc_side)

    log.info(
        "moments_extracted",
        external_game_id=external_game_id,
        kills=len(kills),
        moments=len(moments),
        classifications={m.classification: sum(1 for m2 in moments if m2.classification == m.classification) for m in moments},
    )

    return moments, kills, gold_snapshots


def _record_gold(
    gold_snapshots: dict[int, dict[str, int]],
    kda: dict,
    participants: dict,
    game_seconds: int,
) -> None:
    """Record team gold totals from a KDA snapshot."""
    blue_gold = 0
    red_gold = 0
    for pid, stats in kda.items():
        p = participants.get(str(pid), {})
        side = p.get("side", "")
        gold = stats.get("gold", 0)
        if side == "blue":
            blue_gold += gold
        elif side == "red":
            red_gold += gold
    gold_snapshots[game_seconds] = {"blue": blue_gold, "red": red_gold}


def _parse_ts(ts_str: str) -> datetime:
    """Parse an RFC 3339 / ISO 8601 timestamp."""
    from dateutil.parser import isoparse
    return isoparse(ts_str)


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
    new_assistants: list[tuple[str, int]] = []  # players who gained +assist this frame

    for pid in curr:
        p_curr = curr[pid]
        p_prev = prev.get(pid, {"kills": 0, "deaths": 0, "assists": 0})

        dk = p_curr.get("kills", 0) - p_prev.get("kills", 0)
        dd = p_curr.get("deaths", 0) - p_prev.get("deaths", 0)
        da = p_curr.get("assists", 0) - p_prev.get("assists", 0)

        if dk > 0:
            new_killers.append((pid, dk))
        if dd > 0:
            new_victims.append((pid, dd))
        if da > 0:
            new_assistants.append((pid, da))

    if not new_killers and not new_victims:
        return []

    epoch = _parse_epoch_ms(frame_ts)

    # ─── Build assistants list for each kill ──────────────────────────────
    # Players who gained +1 assist in the same frame as the kill, on the
    # SAME SIDE as the killer (and excluding the killer themselves).
    def _find_assistants(killer_pid: str, killer_side: str) -> list[dict]:
        result = []
        for a_pid, _da in new_assistants:
            if a_pid == killer_pid:
                continue
            a_info = participants.get(a_pid, {})
            if a_info.get("side") == killer_side:
                result.append({
                    "participant_id": a_pid,
                    "name": a_info.get("name"),
                    "champion": a_info.get("champion"),
                })
        return result

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

            assists = _find_assistants(killer_pid, killer_info.get("side", ""))
            # If there are assists, it's NOT a solo kill → medium confidence
            conf = "high" if not assists else "medium"

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
                assistants=assists,
                confidence=conf,
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
            assists = _find_assistants(killer_pid, "blue")
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
                assistants=assists,
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
            assists = _find_assistants(killer_pid, "red")
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
                assistants=assists,
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


def _classify_fight_type(n_concurrent: int, n_assists: int, multi_kill: str | None) -> str:
    """Live classification of fight_type at insertion time.

    Wave 27.18 — mirrors the post-hoc classifier in backfill_assists.py
    so new kills get fight_type set the moment they land in the DB
    instead of waiting for an offline backfill pass to fix them.

    Inputs :
      * n_concurrent — number of OTHER kills detected in the SAME frame
                       (excluding self). The frame is ~10s wide so this
                       captures live teamfight clustering.
      * n_assists    — len(kill.assistants).
      * multi_kill   — None / 'double' / 'triple' / 'quadra' / 'penta'.

    The 30-second sliding-window correction (which catches pentas
    spread across consecutive frames) is left to backfill_assists.py
    — the harvester only sees one frame at a time so it can't compute
    that window cleanly.
    """
    if multi_kill:
        mk = multi_kill.lower()
        if mk in ("triple", "quadra"):
            return "solo_kill"  # carry moment
        if mk == "penta":
            return "teamfight_5v5" if n_concurrent >= 5 else "solo_kill"
    if n_concurrent <= 1:
        if n_assists == 0:
            return "solo_kill"
        if n_assists == 1:
            return "pick"
        return "gank"
    if n_concurrent == 2:
        return "skirmish_2v2"
    if n_concurrent == 3:
        return "skirmish_3v3"
    if n_concurrent <= 5:
        return "teamfight_4v4"
    return "teamfight_5v5"


# ─── Daemon loop ────────────────────────────────────────────────────────────

GAMES_PER_CYCLE = 100


@run_logged()
async def run() -> int:
    """Scan games whose kills haven't been extracted yet and fill them in.

    Wave 27.4 hardening :
      * Per-cycle bound (GAMES_PER_CYCLE) + oldest-first ordering. The
        previous unbounded scan silently truncated at PostgREST's 1000-
        row default once the backlog crossed it.
      * kills_extracted is only flipped to True when EVERY KC kill row
        was confirmed inserted in Supabase. A safe_insert that fell
        back to local_cache (DB outage, transient HTTP error) returns
        None ; we'd previously still flip the flag, so the cache replay
        would land the rows in Supabase but the harvester would never
        re-run on the same game. With explicit success tracking, a
        partial-failure leaves the game extractable on the next cycle.
    """
    log.info("harvester_scan_start")

    # Wave 27.16 — pull matches.scheduled_at via embed so we can skip
    # games whose match hasn't started yet. Without this filter the
    # harvester pounded the live-stats feed for every future-scheduled
    # game on every cycle (sentinel inserts games as 'pending' the
    # moment the match appears on the schedule, days before it airs)
    # generating 70+ unhealthy_window warnings per hour for nothing.
    games = safe_select(
        "games",
        "id, external_id, kills_extracted, state, "
        "matches!games_match_id_fkey(scheduled_at)",
        kills_extracted=False,
        _limit=GAMES_PER_CYCLE,
        _order="created_at.asc",
    )

    # Skip games scheduled more than 30 minutes in the future. 30-minute
    # buffer covers the common "early-arrived live feed" case where the
    # broadcast preamble + draft are airing before scheduled_at.
    from datetime import datetime, timezone
    from datetime import timedelta as _td
    now_plus_buffer = datetime.now(timezone.utc) + _td(minutes=30)
    skipped_future = 0

    total_kills = 0
    for game in games:
        if game.get("kills_extracted"):
            continue
        if game.get("state") not in ("vod_found", "pending", "completed"):
            continue
        if not game.get("external_id"):
            continue
        # Future-match guard
        match_meta = game.get("matches") or {}
        sched = match_meta.get("scheduled_at") if isinstance(match_meta, dict) else None
        if sched:
            try:
                sched_dt = datetime.fromisoformat(str(sched).replace("Z", "+00:00"))
                if sched_dt > now_plus_buffer:
                    skipped_future += 1
                    continue
            except (ValueError, TypeError):
                # Don't gate on unparseable dates — fall through to extract.
                pass

        kills = await extract_kills_from_game(
            external_game_id=game["external_id"],
            db_game_id=game["id"],
        )

        # 🐛 2026-04-28 fix : KC-only filter at insertion time.
        #
        # Pre-fix the harvester inserted EVERY kill of a game KC played
        # (typically 30-50 kills) including N-vs-N teamfights between
        # the OTHER team's members. Those rows had
        # `tracked_team_involvement = NULL` (no KC killer / victim /
        # assistant) and just polluted the pipeline — clipping cycles,
        # Gemini analysis tokens, R2 storage, all wasted on content the
        # site doesn't show. A snapshot on 2026-04-28 found 4899
        # polluted rows out of 12 326 (40 % of the raw backlog).
        #
        # We're a KC fan site : if KC isn't involved, it doesn't ship.
        # Skip these rows at the insertion gate so the pipeline only
        # processes things users will actually see on /scroll.
        kc_kills = [
            k for k in kills if k.tracked_team_involvement is not None
        ]
        skipped = len(kills) - len(kc_kills)

        # Wave 27.18 — compute fight_type per-kill using ALL kills in
        # this game's batch (not just the KC subset) for the
        # n_concurrent count, since teamfights involve both sides.
        # Bucket kills by event_epoch within ±10s windows to mirror
        # the backfill_assists.py 15s tolerance, but slightly tighter
        # for live precision. Falls back to NULL on edge cases ; the
        # post-hoc backfill catches anything missed.
        for k in kc_kills:
            try:
                # Concurrent = kills in same epoch window (±10s)
                window_min = k.event_epoch - 10_000
                window_max = k.event_epoch + 10_000
                n_concurrent = sum(
                    1 for other in kills
                    if other is not k
                    and window_min <= other.event_epoch <= window_max
                )
                k.fight_type = _classify_fight_type(
                    n_concurrent=n_concurrent,
                    n_assists=len(k.assistants or []),
                    multi_kill=k.multi_kill,
                )
            except Exception as e:
                # Non-fatal — leave fight_type=None for backfill to fix.
                log.debug(
                    "harvester_fight_type_failed",
                    kill_event_epoch=k.event_epoch,
                    error=str(e)[:120],
                )

        # Wave 27.4 — track per-row insert outcome. safe_insert returns
        # None when the DB write failed and the row was buffered to the
        # local cache for replay. The replay will eventually land it,
        # but we shouldn't claim "extracted" on a partial confirm — a
        # crash before flush would silently drop the cached rows AND
        # mask the game from the next harvester scan.
        confirmed = 0
        for k in kc_kills:
            if safe_insert("kills", k.to_db_dict()) is not None:
                confirmed += 1
            total_kills += 1

        # CRITICAL : only mark as extracted when we got kills AND every
        # row was confirmed in Supabase. Confirmed < kc_kills means at
        # least one row is sitting in the local cache, so leave the
        # flag False so the next cycle retries.
        if kc_kills and confirmed == len(kc_kills):
            safe_update("games", {"kills_extracted": True}, "id", game["id"])
            if skipped:
                log.info(
                    "harvester_filtered_non_kc",
                    game_id=game["id"][:8],
                    inserted=confirmed,
                    skipped=skipped,
                )
        elif kc_kills and confirmed < len(kc_kills):
            log.warn(
                "harvester_partial_insert",
                game_id=game["id"][:8],
                external=game["external_id"],
                inserted=confirmed,
                attempted=len(kc_kills),
                skipped_non_kc=skipped,
            )
        else:
            log.warn(
                "harvester_zero_kills",
                game_id=game["id"][:8],
                external=game["external_id"],
                skipped_non_kc=skipped,
            )

    log.info(
        "harvester_scan_done",
        games_processed=len(games),
        kills_inserted=total_kills,
        skipped_future=skipped_future,
    )
    return total_kills
