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

Daemon interval: 30 seconds. Pipeline latency target: < 5 minutes.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import traceback
from datetime import datetime, timezone

import structlog

from services.supabase_client import safe_select, safe_update

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
    else:
        raise ValueError(f"Unknown job kind: {kind}")


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

async def run() -> int:
    """Poll worker_jobs for pending, execute each one serially."""
    pending = safe_select("worker_jobs", "id,kind,payload,retry_count", status="pending") or []
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
