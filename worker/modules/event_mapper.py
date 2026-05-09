"""
EVENT_MAPPER — Populate game_events (the canonical map) post-harvest.

Why : we need ONE row per detectable in-game event, before any clip work.
The user's words : "tu fais une table profonde [...] et après on coche
les cases dès qu'on a les clips propres". This module IS the "table
profonde" insertion phase. Other modules tick the boxes.

Pipeline position
─────────────────
  harvester   ──► kills, moments
  event_mapper (THIS) ──► game_events

  (clipper / clip_qc / analyzer / event_publisher then tick QC gates
   on the game_events row, see EVENT_MAP_SPEC.md)

Strategy
────────
1. Pick games where games.event_mapping_complete=FALSE AND kills_extracted=TRUE.
2. For each game :
   a. Find every kill row for the game.
   b. Find every moment row for the game.
   c. INSERT one game_events row per kill (auto_kill source).
      Insert relies on the unique partial index uniq_game_events_kill
      to dedup — re-runs on the same game are no-ops.
   d. INSERT one game_events row per moment NOT already covered by a kill
      (e.g. teamfight moments that span multiple kills get one extra row
      typed 'teamfight' / 'skirmish' / 'ace', auto_moment source).
3. Set games.event_mapping_complete=TRUE.

Idempotent : re-running on the same set of games = no inserts (unique
indexes block dupes), but does flip the completion flag if it wasn't set.

Daemon interval : 600s (10 min). The harvester runs at 600s too, so we're
always at most one cycle behind it. Sentinel.boost during live matches
forces both modules to 30s, so the canonical map stays fresh during games.

PR-arch P1 : queue-first via pipeline_jobs.
  * Claim `event.map` jobs.
  * NOTE on entity model : the dispatcher (and analyzer downstream
    enqueue) keys event.map jobs by KILL — entity_type='kill',
    entity_id=kill_id. But map_game() naturally operates per-game.
    We translate : look up the kill's game_id, then run map_game
    once per unique game across the claimed batch. All jobs targeting
    the same game share the resulting count and are acked together.
    The unique-on-(game_id, kill_id) and unique-on-(game_id, moment_id)
    partial indexes on game_events keep the inserts idempotent, so
    multiple kill-keyed jobs hitting the same game don't double-insert.
  * If the queue is empty, fall back to the legacy game-scan path
    (event_mapping_complete=FALSE AND kills_extracted=TRUE).
  * Lease : 60s (one game = a couple of REST calls + bulk insert).
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone

import httpx
import structlog

from services import job_queue
from services.observability import run_logged
from services.schema_cache import table_exists
from services.supabase_client import get_db, safe_select, safe_update

# Column set we actually SELECT from `moments`. Used by table_exists() to
# probe table+column shape once per process and skip the call entirely if
# the table is missing or the columns drifted (silences a 400 spam loop —
# `start_epoch` was a planned column that was never shipped).
_MOMENTS_COLUMNS = (
    "id,game_id,start_epoch,start_time_seconds,end_time_seconds,"
    "classification,kc_involvement,blue_team_gold,red_team_gold,gold_swing,"
    "clip_url_vertical,kill_visible,ai_description,status"
)

log = structlog.get_logger()


# Mapping from kill row to event_type. Mirrored from migration 014's
# backfill SELECT — keep in sync.
def _classify_kill_event(kill: dict) -> str:
    if kill.get("is_first_blood"):
        return "first_blood"
    mk = kill.get("multi_kill")
    if mk in ("triple", "quadra", "penta"):
        return "multi_kill"
    if mk == "double":
        return "duo_kill"
    ft = kill.get("fight_type")
    if ft in ("teamfight_5v5", "teamfight_4v4"):
        return "teamfight"
    if ft == "skirmish":
        return "skirmish"
    return "solo_kill"


def _classify_moment_event(moment: dict) -> str:
    """Map moments.classification → game_events.event_type."""
    cls = (moment.get("classification") or "").lower()
    if cls == "ace":
        return "ace"
    if cls == "teamfight":
        return "teamfight"
    if cls == "skirmish":
        return "skirmish"
    if cls == "objective_fight":
        return "teamfight"  # collapse to teamfight for now; objective_taken types ship later
    if cls == "solo_kill":
        return "solo_kill"
    return "other"


def _tracked_team_involvement_from_kill(kill: dict) -> str:
    """Translate kills.tracked_team_involvement → game_events.tracked_team_involvement.

    PR-loltok DH (migration 045) renamed the destination column on
    game_events from kc_involvement → tracked_team_involvement. The
    VALUE vocabulary (kc_winner / kc_loser / kc_neutral / no_kc) is
    unchanged — the value sweep ships separately to avoid coupling
    the rename with a wider refactor.
    """
    tti = kill.get("tracked_team_involvement")
    if tti == "team_killer":
        return "kc_winner"
    if tti == "team_victim":
        return "kc_loser"
    if tti == "team_assist":
        return "kc_winner"
    return "no_kc"


def _tracked_team_involvement_from_moment(moment: dict) -> str:
    """Translate moments.kc_involvement → game_events.tracked_team_involvement.

    Note : the SOURCE column moments.kc_involvement is NOT renamed in
    migration 045. Only the destination column on game_events was.
    """
    mi = moment.get("kc_involvement")
    if mi == "kc_aggressor":
        return "kc_winner"
    if mi == "kc_victim":
        return "kc_loser"
    if mi == "kc_both":
        return "kc_neutral"
    return "no_kc"


# ─── Event row builders ───────────────────────────────────────────────

def _kill_to_event_row(kill: dict) -> dict:
    """Build the INSERT payload for game_events from a kill row."""
    assistants = kill.get("assistants")
    if isinstance(assistants, str):
        try:
            assistants = json.loads(assistants)
        except (json.JSONDecodeError, TypeError):
            assistants = []
    elif not isinstance(assistants, list):
        assistants = []

    return {
        "game_id": kill["game_id"],
        "event_type": _classify_kill_event(kill),
        "multi_kill_grade": kill.get("multi_kill"),
        "event_epoch": kill.get("event_epoch") or 0,
        "game_time_seconds": kill.get("game_time_seconds") or 0,
        "primary_actor_player_id": kill.get("killer_player_id"),
        "primary_actor_champion": kill.get("killer_champion"),
        "primary_target_player_id": kill.get("victim_player_id"),
        "primary_target_champion": kill.get("victim_champion"),
        "secondary_actors": assistants,
        # PR-loltok DH (migration 045) : column renamed kc_involvement →
        # tracked_team_involvement on game_events. INSERTs use the new
        # name unconditionally — the operator MUST apply migration 045
        # before restarting onto this code. event_publisher has the
        # read-side migration-window fallback.
        "tracked_team_involvement": _tracked_team_involvement_from_kill(kill),
        "kill_id": kill["id"],
        # QC ticks pre-derived from current kill state — same logic as
        # migration 014 backfill, so re-mapping a game gives identical
        # rows to the original backfill.
        "qc_clip_produced": kill.get("clip_url_vertical") is not None,
        "qc_clip_validated": (
            kill.get("status") in ("analyzed", "published")
            and kill.get("clip_url_vertical") is not None
        ),
        "qc_typed": (
            kill.get("killer_champion") is not None
            and kill.get("victim_champion") is not None
        ),
        # Wave 27.15 — threshold lowered from 80 to 50 chars to align
        # with analyzer.MIN_DESCRIPTION_CHARS. The two were inconsistent :
        # analyzer accepted >=50 char descriptions and published them via
        # kills.status='published' (visible on /scroll), but the canonical
        # map's qc_described still required >80 chars, so 219 of the 982
        # currently-published kills had qc_described=FALSE and is_publishable
        # =FALSE. Once the new event-publisher path takes over fully, those
        # 219 would silently disappear from the feed. Aligning at 50 keeps
        # them in.
        "qc_described": (
            kill.get("ai_description") is not None
            and len(str(kill.get("ai_description") or "")) >= 50
        ),
        "qc_visible": kill.get("kill_visible"),
        "detection_source": "auto_kill",
        "detection_confidence": kill.get("confidence") or "high",
    }


def _moment_to_event_row(moment: dict) -> dict:
    """Build the INSERT payload for game_events from a moment row.

    Moments don't have champions or per-player primary_actor — they're
    cluster-level. We leave actor fields NULL.
    """
    return {
        "game_id": moment["game_id"],
        "event_type": _classify_moment_event(moment),
        "multi_kill_grade": None,
        "event_epoch": moment.get("start_epoch") or 0,
        "game_time_seconds": moment.get("start_time_seconds") or 0,
        "duration_seconds": (
            (moment.get("end_time_seconds") or 0)
            - (moment.get("start_time_seconds") or 0)
        ),
        "secondary_actors": [],
        # PR-loltok DH (migration 045) — see _kill_to_event_row above.
        "tracked_team_involvement": _tracked_team_involvement_from_moment(moment),
        "moment_id": moment["id"],
        "qc_clip_produced": moment.get("clip_url_vertical") is not None,
        "qc_clip_validated": (
            moment.get("status") in ("analyzed", "published")
            and moment.get("clip_url_vertical") is not None
        ),
        "qc_typed": True,            # classification already enforced by moments table CHECK
        # Wave 27.15 — same threshold alignment as _kill_to_event_row.
        "qc_described": (
            moment.get("ai_description") is not None
            and len(str(moment.get("ai_description") or "")) >= 50
        ),
        "qc_visible": moment.get("kill_visible"),  # might be NULL
        "blue_team_gold": moment.get("blue_team_gold"),
        "red_team_gold": moment.get("red_team_gold"),
        "gold_swing": moment.get("gold_swing"),
        "detection_source": "auto_moment",
        "detection_confidence": "medium",
    }


async def _bulk_insert_events(db, rows: list[dict]) -> int:
    """POST a batch of events to PostgREST. Idempotent via unique partial
    indexes on kill_id / moment_id — duplicates are silently dropped via
    Prefer: resolution=ignore-duplicates.

    Wave 27.10 — converted to async + asyncio.to_thread (the inner
    httpx.post call is offloaded). Caller in map_game() now awaits.

    Note (2026-04-27) : we tried to use `?on_conflict=kill_id` to make
    duplicates a no-op INSTEAD of a 409. That returned 42P10 ("no
    unique or exclusion constraint matching the ON CONFLICT
    specification") because the unique indexes are PARTIAL
    (`WHERE kill_id IS NOT NULL`) and PostgREST can't infer the partial
    expression from just the column name. Reverted to the original
    plain INSERT — duplicates still log a 409 warning but the row
    doesn't get inserted twice. Cosmetic noise only, no data integrity
    impact. A proper fix would need to either (a) rebuild the index as
    a NON-partial constraint, or (b) drop the unique index and rely on
    application-level dedup before the bulk insert.

    Returns the number of new rows inserted (best-effort; PostgREST
    returns the inserted set when Prefer=return=representation).
    """
    if not rows:
        return 0
    headers = {
        **db.headers,
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=representation",
    }
    try:
        # Wave 27.10 — sync httpx.post offloaded so a 30s upper bound
        # on a multi-row insert doesn't freeze the event loop.
        r = await asyncio.to_thread(
            httpx.post,
            f"{db.base}/game_events",
            headers=headers,
            json=rows,
            timeout=30.0,
        )
        if r.status_code in (200, 201):
            inserted = r.json() or []
            return len(inserted)
        # 409 = duplicate (idempotent skip). 400 / 5xx = real failure.
        # Lower the warning level for 409 so it doesn't drown real bugs.
        level = log.debug if r.status_code == 409 else log.warn
        level(
            "event_mapper_insert_failed",
            status=r.status_code,
            body=r.text[:300],
            batch_size=len(rows),
        )
        return 0
    except Exception as e:
        log.error("event_mapper_insert_threw", error=str(e)[:200])
        return 0


# ─── Per-game mapping ─────────────────────────────────────────────────

async def map_game(db, game: dict) -> dict:
    """Insert all event rows for one game. Returns counters dict."""
    gid = game["id"]
    counters = {"kills_in_game": 0, "moments_in_game": 0, "inserted": 0}

    # Pull kills + moments with a single REST call each. Keep field set
    # narrow to limit egress.
    kills = safe_select(
        "kills",
        "id,game_id,event_epoch,game_time_seconds,killer_player_id,killer_champion,"
        "victim_player_id,victim_champion,assistants,confidence,is_first_blood,"
        "multi_kill,fight_type,tracked_team_involvement,clip_url_vertical,"
        "kill_visible,ai_description,status",
        game_id=gid,
    ) or []
    counters["kills_in_game"] = len(kills)

    # Moments table : same select but moment-shaped columns. May be empty
    # if migration 002 wasn't applied yet OR if the column set drifted
    # (e.g. `start_epoch` was planned but never shipped). The shape probe
    # in schema_cache silences both cases without log noise — we only hit
    # Supabase if the table+columns are actually queryable.
    if table_exists("moments", columns=_MOMENTS_COLUMNS):
        try:
            moments = safe_select("moments", _MOMENTS_COLUMNS, game_id=gid) or []
        except Exception:
            moments = []
    else:
        moments = []
    counters["moments_in_game"] = len(moments)

    rows: list[dict] = []
    for k in kills:
        rows.append(_kill_to_event_row(k))
    for m in moments:
        rows.append(_moment_to_event_row(m))

    if rows:
        counters["inserted"] = await _bulk_insert_events(db, rows)

    # Mark the game as mapped (idempotent — flip is cheap)
    safe_update(
        "games",
        {
            "event_mapping_complete": True,
            "event_mapping_completed_at": datetime.now(timezone.utc).isoformat(),
        },
        "id",
        gid,
    )

    return counters


# ─── Daemon entry point ───────────────────────────────────────────────

# How many games to process per cycle. Mapping is cheap (a couple of
# REST calls + one bulk insert per game), so a generous cap is fine.
GAMES_PER_RUN = 50
BATCH_SIZE = 100
LEASE_SECONDS = 60


def _resolve_game_id(entity_type: str | None, entity_id: str | None) -> str | None:
    """Translate a job's (entity_type, entity_id) into a game_id.

    Most event.map jobs are kill-keyed (the dispatcher + analyzer enqueue
    them per kill_id). Some legacy callers may key directly by game.
    Both shapes are supported.
    """
    if not entity_id:
        return None
    if entity_type == "game":
        return entity_id
    # Default : assume kill_id and look up its game.
    rows = safe_select("kills", "id,game_id", id=entity_id)
    if not rows:
        return None
    return rows[0].get("game_id")


@run_logged()
async def run() -> int:
    """Map every game where event_mapping_complete=FALSE AND kills_extracted=TRUE.

    Order :
      1. Claim `event.map` jobs from pipeline_jobs. Resolve each job's
         entity_id (usually a kill_id) to a game_id, then coalesce so
         each unique game is mapped exactly once. Ack all jobs sharing
         the game with the same result.
      2. If the queue is empty, fall back to the legacy game-scan path
         AND enqueue jobs for what we find.
      3. map_game() is idempotent — re-runs on the same game = no inserts
         (unique partial indexes on kill_id / moment_id) but a flag flip.

    Returns the total event rows inserted across all games processed.
    """
    log.info("event_mapper_start")

    db = get_db()
    if not db:
        return 0

    worker_id = f"event_mapper-{os.getpid()}"

    # ─── 1. Queue-first claim ──────────────────────────────────────
    claimed = await asyncio.to_thread(
        job_queue.claim,
        worker_id,
        ["event.map"],
        BATCH_SIZE,
        LEASE_SECONDS,
    )

    legacy_fallback_used = False
    total_inserted = 0
    games_done = 0

    if claimed:
        # Group jobs by game_id so we map each game exactly once.
        # game_id -> list[job_dict]
        game_jobs: dict[str, list[dict]] = {}
        bad_jobs: list[dict] = []
        for job in claimed:
            gid = _resolve_game_id(job.get("entity_type"), job.get("entity_id"))
            if not gid:
                bad_jobs.append(job)
                continue
            game_jobs.setdefault(gid, []).append(job)

        # Ack the unresolvable ones so they don't pile up.
        for job in bad_jobs:
            await asyncio.to_thread(
                job_queue.fail, job["id"],
                "could not resolve entity to game_id",
                3600, "map_failed",
            )

        log.info(
            "event_mapper_queue",
            claimed=len(claimed),
            unique_games=len(game_jobs),
            unresolvable=len(bad_jobs),
        )

        for gid, jobs in game_jobs.items():
            try:
                counters = await map_game(db, {"id": gid})
                total_inserted += counters["inserted"]
                games_done += 1
                log.info(
                    "event_mapper_game_done",
                    game_id=gid[:8],
                    kills=counters["kills_in_game"],
                    moments=counters["moments_in_game"],
                    inserted=counters["inserted"],
                    coalesced_jobs=len(jobs),
                )
                # Ack every job that targeted this game.
                for job in jobs:
                    await asyncio.to_thread(
                        job_queue.succeed, job["id"],
                        {
                            "game_id": gid,
                            "inserted": counters["inserted"],
                            "kills": counters["kills_in_game"],
                            "moments": counters["moments_in_game"],
                        },
                    )
            except Exception as e:
                log.error(
                    "event_mapper_game_error",
                    game_id=gid[:8], error=str(e)[:200],
                )
                # Fail every job that targeted this game so the retry
                # comes back as a unit.
                for job in jobs:
                    await asyncio.to_thread(
                        job_queue.fail, job["id"],
                        f"map_game_exception: {type(e).__name__}",
                        180, "map_failed",
                    )

    # ─── 2. Legacy fallback if queue was empty ────────────────────
    if not claimed:
        legacy_fallback_used = True

        # PostgREST query — both filters as eq.X. Limit to the cap so a
        # huge backlog doesn't stall the daemon.
        try:
            # Wave 27.10 — sync httpx.get offloaded so the legacy-
            # fallback scan doesn't block the event loop on startup
            # before the queue path takes over.
            r = await asyncio.to_thread(
                httpx.get,
                f"{db.base}/games",
                headers=db.headers,
                params={
                    "select": "id,external_id",
                    "kills_extracted": "eq.true",
                    "event_mapping_complete": "eq.false",
                    "limit": GAMES_PER_RUN,
                },
                timeout=15.0,
            )
            if r.status_code != 200:
                log.warn("event_mapper_query_failed", status=r.status_code, body=r.text[:200])
                return 0
            games = r.json() or []
        except Exception as e:
            log.warn("event_mapper_query_threw", error=str(e)[:120])
            return 0

        if not games:
            log.info("event_mapper_no_pending")
            return 0

        log.info("event_mapper_legacy_fallback_batch", games=len(games))

        # Enqueue one event.map job per game so subsequent passes go
        # through the queue. Idempotent via the unique index.
        enqueued = 0
        for g in games:
            jid = await asyncio.to_thread(
                job_queue.enqueue,
                "event.map", "game", g["id"],
                None, 50, None, 3,
            )
            if jid:
                enqueued += 1

        for g in games:
            try:
                counters = await map_game(db, g)
                total_inserted += counters["inserted"]
                games_done += 1
                log.info(
                    "event_mapper_game_done",
                    game_id=g["id"][:8],
                    external_id=g.get("external_id"),
                    kills=counters["kills_in_game"],
                    moments=counters["moments_in_game"],
                    inserted=counters["inserted"],
                )
            except Exception as e:
                log.error(
                    "event_mapper_game_error",
                    game_id=g.get("id", "")[:8],
                    error=str(e)[:200],
                )

        log.info(
            "event_mapper_legacy_enqueued",
            enqueued_for_next_pass=enqueued,
        )

    log.info(
        "event_mapper_done",
        games_processed=games_done,
        events_inserted=total_inserted,
        legacy_fallback=legacy_fallback_used,
    )
    return total_inserted
