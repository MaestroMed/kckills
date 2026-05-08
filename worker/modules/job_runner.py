"""
JOB_RUNNER — Polls the `worker_jobs` table and executes admin-triggered jobs.

Admin UI inserts rows into worker_jobs with status='pending'. This module
polls for those rows, dispatches by `kind`, marks status='running', then
'completed' or 'failed' with result/error.

Supported job kinds (match admin UI + DB CHECK):
  - reanalyze_kill       payload: { kill_id: UUID }
  - reclip_kill          payload: { kill_id: UUID }
  - regen_og             payload: { kill_id: UUID }
  - regen_audit_targets  payload: {} (no args)
  - backfill_assists_game payload: { game_id: str (external_id or UUID) }
  - reanalyze_backlog    payload: {} (reprocess all clips with needs_reclip=true)
  - sentinel.boost       payload: { match_external_id, until_seconds }
                         queued by match_planner — boucle sentinel + harvester
                         toutes les 30s pendant `until_seconds` (default 7200)
  - clip_qc.verify       payload: { kill_id }
                         lance modules.clip_qc sur un clip déjà publié
                         (admin-triggered via /admin/clips/[id] "QC ce clip")

Daemon interval: 30 seconds. Pipeline latency target: < 5 minutes.

Scheduled jobs : worker_jobs.scheduled_for est respecté. Si un row est
pending mais scheduled_for > now, on le skip (il sera pickup au cycle
qui suit son moment d'éligibilité).
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone

import httpx
import structlog

from services.observability import run_logged
from services.supabase_client import get_db, safe_select, safe_update

log = structlog.get_logger()


async def _set_status(job_id: str, status: str, **extras) -> None:
    """Update a worker_jobs row status + optional fields."""
    patch = {"status": status, **extras}
    if status == "running":
        patch["started_at"] = datetime.now(timezone.utc).isoformat()
    if status in ("completed", "failed", "cancelled"):
        patch["completed_at"] = datetime.now(timezone.utc).isoformat()
    safe_update("worker_jobs", patch, "id", job_id)


async def _dispatch(job: dict) -> dict:
    """Execute a single job, return result dict or raise."""
    kind = job.get("kind")
    payload = job.get("payload") or {}

    log.info("job_dispatch", kind=kind, job_id=job["id"][:8], payload=payload)

    if kind == "reanalyze_kill":
        return await _reanalyze_kill(payload.get("kill_id"))
    elif kind == "reclip_kill":
        return await _reclip_kill(payload.get("kill_id"))
    elif kind == "regen_og":
        return await _regen_og(payload.get("kill_id"))
    elif kind == "regen_audit_targets":
        return await _regen_audit_targets()
    elif kind == "backfill_assists_game":
        return await _backfill_assists_game(payload.get("game_id"))
    elif kind == "reanalyze_backlog":
        return await _reanalyze_backlog()
    elif kind == "sentinel.boost":
        return await _sentinel_boost(payload)
    elif kind == "clip_qc.verify":
        return await _clip_qc_verify(payload.get("kill_id"))
    else:
        raise ValueError(f"Unknown job kind: {kind}")


# ─── Boost loop — runs in background, marks job as completed instantly ──

async def _sentinel_boost(payload: dict) -> dict:
    """Spawn a background task that loops sentinel + harvester at 30s
    cadence until `until_seconds` elapse. Returns immediately so the
    job_runner can pick up other pending jobs in parallel.

    The loop is fire-and-forget — if it crashes, it's just lost (next
    match_planner run will queue a new boost).
    """
    until_seconds = int(payload.get("until_seconds") or 7200)
    match_ext = payload.get("match_external_id")

    # Wave 27.9 — atomic check-then-mark. Adding to the set BEFORE
    # spawning closes a race where two boost jobs for the same match
    # arriving back-to-back could both pass the membership check
    # (the spawned task adds to the set inside the coroutine, which
    # only runs once the event loop yields). The boost loop's finally
    # block discards the entry on exit, so a crashed loop doesn't
    # poison subsequent runs.
    if match_ext:
        if match_ext in _active_boosts:
            return {"boost_skipped": "already_running", "match": match_ext}
        _active_boosts.add(match_ext)

    # Wave 27.9 — task_supervisor.spawn keeps a strong reference + logs
    # uncaught exceptions. The previous bare create_task could be GC'd
    # mid-run if the loop ran out of memory or the task wasn't picked up
    # by the scheduler before the next gc.collect() cycle.
    from services.task_supervisor import spawn
    spawn(
        _run_boost_loop(until_seconds, match_ext),
        name=f"boost_loop_{match_ext or 'unknown'}",
    )
    return {
        "boost_started": True,
        "duration_s": until_seconds,
        "match": match_ext,
    }


_active_boosts: set[str] = set()


async def _run_boost_loop(until_seconds: int, match_ext: str | None):
    """Inner loop — sentinel + harvester every 30s for the duration.

    Wave 27.9 — _active_boosts membership is owned by the caller now
    (_sentinel_boost adds atomically with the create_task spawn so two
    racing boost jobs can't both pass the duplicate check). The finally
    block below still discards on exit so a crashed loop releases the
    slot.
    """
    log.info("boost_loop_start", match=match_ext, duration_s=until_seconds)
    end = time.monotonic() + until_seconds
    cycles = 0
    try:
        # Lazy-import to avoid circular deps at module load
        from modules import sentinel, harvester
        while time.monotonic() < end:
            try:
                await sentinel.run()
                await harvester.run()
                cycles += 1
            except Exception as e:
                log.error(
                    "boost_loop_iteration_error",
                    match=match_ext,
                    error=str(e)[:200],
                )
            await asyncio.sleep(30)
    finally:
        if match_ext:
            _active_boosts.discard(match_ext)
        log.info("boost_loop_done", match=match_ext, cycles=cycles)


# ─── clip_qc admin-triggered handler ───────────────────────────────────

async def _clip_qc_verify(kill_id: str | None) -> dict:
    """Run clip_qc.verify_clip_timing on a single published kill.

    Reads the kill's clip URL + game_time_seconds, downloads the clip
    locally, runs Gemini timer reading, returns the drift. Doesn't
    auto-reclip — surfaces the result in the job's `result` field for
    the admin UI to display.
    """
    if not kill_id:
        raise ValueError("kill_id required")

    # Fetch the kill row
    rows = safe_select(
        "kills",
        "id, clip_url_horizontal, game_time_seconds",
        id=kill_id,
    )
    if not rows or not rows[0].get("clip_url_horizontal"):
        return {"kill_id": kill_id, "error": "no horizontal clip URL"}
    row = rows[0]

    # Download the clip to a temp file
    import tempfile
    from modules.clip_qc import verify_clip_timing
    src_url = row["clip_url_horizontal"]
    expected = int(row.get("game_time_seconds") or 0)
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        with httpx.stream("GET", src_url, follow_redirects=True, timeout=60) as r:
            r.raise_for_status()
            with open(tmp_path, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
        is_ok, drift = await verify_clip_timing(tmp_path, expected)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
    # PR6-C : tick the canonical event's qc_clip_validated gate. is_ok
    # = drift within tolerance. If is_ok=False, gate flips to FALSE,
    # which (via the GENERATED is_publishable column) instantly removes
    # the event from the publishable pool.
    try:
        from services.event_qc import tick_qc_clip_validated, fail_qc_clip_validated
        if is_ok:
            tick_qc_clip_validated(kill_id)
        else:
            fail_qc_clip_validated(kill_id, reason=f"drift={drift}s")
    except Exception as _e:
        log.warn("event_qc_tick_failed", kill_id=kill_id[:8], stage="clip_validated", error=str(_e)[:120])
    return {
        "kill_id": kill_id,
        "expected_game_time": expected,
        "is_ok": is_ok,
        "drift_seconds": drift,
        "needs_reclip": (not is_ok) and abs(drift) > 30,
    }


# ─── Job handlers ────────────────────────────────────────────────────────

async def _reanalyze_kill(kill_id: str | None) -> dict:
    """Reset a kill to status='clipped' so the analyzer picks it up next cycle."""
    if not kill_id:
        raise ValueError("kill_id required")
    safe_update("kills", {"status": "clipped", "retry_count": 0}, "id", kill_id)
    return {"kill_id": kill_id, "reset_to": "clipped"}


async def _reclip_kill(kill_id: str | None) -> dict:
    """Mark a kill for re-clipping. Harvester/clipper re-run on next cycle."""
    if not kill_id:
        raise ValueError("kill_id required")
    safe_update("kills", {
        "status": "vod_found",
        "needs_reclip": True,
        "retry_count": 0,
    }, "id", kill_id)
    return {"kill_id": kill_id, "reset_to": "vod_found"}


async def _regen_og(kill_id: str | None) -> dict:
    """Clear og_image_url so og_generator recreates it next cycle."""
    if not kill_id:
        raise ValueError("kill_id required")
    safe_update("kills", {"og_image_url": None, "status": "analyzed"}, "id", kill_id)
    return {"kill_id": kill_id, "cleared": "og_image_url"}


async def _regen_audit_targets() -> dict:
    """Run the regen_audit_targets script (45 clips marked as bad by Opus audit)."""
    from scripts import regen_audit_targets
    # Script has a main() that we call with --yes flag via monkey patch
    # Easier: directly reset the target prefixes
    import sys as _sys
    argv_backup = _sys.argv
    try:
        _sys.argv = ["regen_audit_targets", "--yes"]
        regen_audit_targets.main()
    finally:
        _sys.argv = argv_backup
    return {"status": "done"}


async def _backfill_assists_game(game_ext_id: str | None) -> dict:
    """Re-harvest assists from livestats for a specific game."""
    if not game_ext_id:
        raise ValueError("game_id required")
    # Delegate to the backfill_assists script logic for a single game
    from backfill_assists import harvest_kills_with_assists, classify_fight, match_kill_to_db
    # Get game + kills
    games = safe_select("games", "id,external_id", external_id=game_ext_id)
    if not games:
        raise ValueError(f"Game {game_ext_id} not found in DB")
    game = games[0]

    db_kills = safe_select(
        "kills", "id,game_id,game_time_seconds,killer_champion,victim_champion,fight_type,multi_kill",
        game_id=game["id"],
    ) or []

    detected = harvest_kills_with_assists(game_ext_id)
    if not detected:
        return {"game_id": game_ext_id, "status": "no livestats data"}

    matched = 0
    changed = 0
    for det in detected:
        db_kill = match_kill_to_db(det, db_kills)
        if not db_kill:
            continue
        matched += 1
        import json
        patch = {"assistants": json.dumps(det["assistants"])}
        new_ft = classify_fight(det["n_concurrent"], det["n_assists"], db_kill.get("multi_kill"))
        if new_ft != db_kill.get("fight_type"):
            patch["fight_type"] = new_ft
            changed += 1
        safe_update("kills", patch, "id", db_kill["id"])

    return {
        "game_id": game_ext_id,
        "detected": len(detected),
        "matched": matched,
        "fight_type_changed": changed,
    }


async def _reanalyze_backlog() -> dict:
    """Reset all clips marked needs_reclip=true to status='clipped' for re-analysis."""
    rows = safe_select("kills", "id", needs_reclip=True) or []
    for r in rows:
        safe_update("kills", {"status": "clipped", "needs_reclip": False, "retry_count": 0}, "id", r["id"])
    return {"reset_count": len(rows)}


# ─── Daemon loop ────────────────────────────────────────────────────────

@run_logged()
async def run() -> int:
    """Poll worker_jobs for pending + scheduled-eligible, execute serially.

    Eligibility = status='pending' AND (scheduled_for <= now OR scheduled_for IS NULL).
    safe_select doesn't expose lte filters, so we go raw httpx for this query.
    """
    db = get_db()
    if not db:
        return 0
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        # PostgREST: combine status=eq.pending AND scheduled_for=lte.now
        # Rows with NULL scheduled_for are also matched via the OR-style
        # `or` filter syntax: or=(scheduled_for.lte.X,scheduled_for.is.null)
        r = httpx.get(
            f"{db.base}/worker_jobs",
            headers=db.headers,
            params={
                "select": "id,kind,payload,retry_count,scheduled_for",
                "status": "eq.pending",
                "or": f"(scheduled_for.lte.{now_iso},scheduled_for.is.null)",
                "limit": 50,
            },
            timeout=15.0,
        )
        if r.status_code != 200:
            log.warn("job_runner_query_failed", status=r.status_code, body=r.text[:200])
            return 0
        pending = r.json() or []
    except Exception as e:
        log.warn("job_runner_query_threw", error=str(e)[:120])
        return 0
    if not pending:
        return 0

    log.info("job_runner_batch", pending=len(pending))

    processed = 0
    for job in pending:
        job_id = job["id"]
        try:
            await _set_status(job_id, "running")
            result = await _dispatch(job)
            await _set_status(job_id, "completed", result=json.dumps(result))
            log.info("job_completed", job_id=job_id[:8], kind=job.get("kind"))
            processed += 1
        except Exception as e:
            err = f"{type(e).__name__}: {str(e)[:300]}"
            log.error("job_failed", job_id=job_id[:8], error=err, tb=traceback.format_exc()[:500])
            new_retry = int(job.get("retry_count") or 0) + 1
            if new_retry >= 3:
                await _set_status(job_id, "failed", error=err, retry_count=new_retry)
            else:
                # Put back to pending for retry
                safe_update("worker_jobs", {
                    "status": "pending",
                    "retry_count": new_retry,
                    "error": err,
                }, "id", job_id)

    return processed
