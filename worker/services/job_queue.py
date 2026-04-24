"""
JOB QUEUE — Wrapper around the pipeline_jobs queue (migration 024 + 025).

Replaces the polling-based "scan kills WHERE status=X" model with explicit
job records :

  enqueue()       Insert a row into pipeline_jobs.
  claim()         Atomic lease-lock claim via fn_claim_pipeline_jobs RPC.
  succeed()       Mark a claimed job as succeeded.
  fail()          Bump attempts ; either re-queue with retry_after or
                  promote to dead_letter_jobs once exhausted.
  renew_lease()   Push the lease deadline forward for long-running jobs.
  get_active_count()  Read backpressure ('pending' + 'claimed' counts).

Design choices :
  * httpx-only (no psycopg) — matches the SupabaseRest client used by the
    rest of the worker. The migration script ran against the cloud, this
    module talks to PostgREST.
  * Synchronous functions (NOT async). The caller already owns its event
    loop, and httpx.Client doesn't need an awaitable wrapper here. The
    async ergonomics in the calling modules use asyncio.to_thread when
    needed (rare — these calls are fast).
  * The unique index on (type, entity_type, entity_id) WHERE status IN
    ('pending','claimed') is the idempotency guard. enqueue() catches the
    23505 unique-violation and returns None instead of raising — callers
    treat this as "already enqueued, fine".
  * fail() with attempts >= max_attempts inserts into dead_letter_jobs
    AND marks the original row as 'failed'. We don't delete the job —
    it stays for audit + the DLQ row carries a FK back to it.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
import structlog

from services.supabase_client import get_db

log = structlog.get_logger()


# ─── Helpers ────────────────────────────────────────────────────────────

def _isoformat(dt: datetime) -> str:
    """Render a tz-aware datetime in PostgREST-friendly ISO 8601."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ─── enqueue ───────────────────────────────────────────────────────────

def enqueue(
    job_type: str,
    entity_type: str | None = None,
    entity_id: str | None = None,
    payload: dict | None = None,
    priority: int = 50,
    run_after: datetime | None = None,
    max_attempts: int = 3,
) -> str | None:
    """Insert a job into pipeline_jobs.

    Returns the job UUID, or None if :
      * Supabase is unreachable
      * The unique constraint blocks (already an active job for this entity)
      * Any other 4xx/5xx happens

    The unique constraint on (type, entity_type, entity_id) WHERE status IN
    ('pending','claimed') means callers can blindly enqueue without first
    checking — the second insert just no-ops.
    """
    db = get_db()
    if db is None:
        log.warn("job_queue_enqueue_no_db", type=job_type, entity_id=entity_id)
        return None

    body: dict[str, Any] = {
        "type": job_type,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "payload": payload or {},
        "priority": int(priority),
        "max_attempts": int(max_attempts),
    }
    if run_after is not None:
        body["run_after"] = _isoformat(run_after)

    try:
        client = db._get_client()
        r = client.post(
            f"{db.base}/pipeline_jobs",
            json=body,
            headers={**db.headers, "Prefer": "return=representation"},
        )
        if r.status_code == 409 or (
            r.status_code in (400, 422) and '"23505"' in (r.text or "")
        ):
            # Unique violation — an active job already exists for this entity.
            return None
        r.raise_for_status()
        rows = r.json() or []
        if not rows:
            return None
        return rows[0].get("id")
    except httpx.HTTPStatusError as e:
        body_preview = (e.response.text or "")[:200]
        # Detect unique violation in case the server returns a different
        # status code than 409 (PostgREST sometimes uses 400).
        if '"23505"' in body_preview:
            return None
        log.warn(
            "job_queue_enqueue_http_error",
            type=job_type, entity_id=entity_id,
            status=e.response.status_code, body=body_preview,
        )
        return None
    except Exception as e:
        log.warn(
            "job_queue_enqueue_failed",
            type=job_type, entity_id=entity_id, error=str(e)[:200],
        )
        return None


# ─── claim ─────────────────────────────────────────────────────────────

def claim(
    worker_id: str,
    job_types: list[str],
    batch_size: int = 5,
    lease_seconds: int = 300,
) -> list[dict]:
    """Atomically claim up to batch_size jobs of the given types.

    Wraps the fn_claim_pipeline_jobs RPC (migration 024) which uses
    SELECT ... FOR UPDATE SKIP LOCKED to avoid races between workers.
    The RPC also re-claims expired leases (worker died mid-job).

    Returns a list of pipeline_jobs rows (dicts). Each row carries
    `attempts` already bumped — when the caller fail()s, attempts is the
    NEXT count, not the previous one.
    """
    db = get_db()
    if db is None:
        return []

    payload = {
        "p_worker_id": worker_id,
        "p_types": list(job_types),
        "p_batch_size": int(batch_size),
        "p_lease_seconds": int(lease_seconds),
    }

    try:
        client = db._get_client()
        r = client.post(
            f"{db.base}/rpc/fn_claim_pipeline_jobs",
            json=payload,
        )
        r.raise_for_status()
        rows = r.json() or []
        if not isinstance(rows, list):
            return []
        return rows
    except httpx.HTTPStatusError as e:
        log.warn(
            "job_queue_claim_http_error",
            worker_id=worker_id, types=job_types,
            status=e.response.status_code,
            body=(e.response.text or "")[:200],
        )
        return []
    except Exception as e:
        log.warn(
            "job_queue_claim_failed",
            worker_id=worker_id, types=job_types,
            error=str(e)[:200],
        )
        return []


# ─── succeed ───────────────────────────────────────────────────────────

def succeed(job_id: str, result: dict | None = None) -> bool:
    """Mark a claimed job as succeeded. Idempotent.

    The fn_pipeline_jobs_touch_updated trigger stamps finished_at
    automatically when status flips to a terminal state.
    """
    db = get_db()
    if db is None:
        return False

    body: dict[str, Any] = {"status": "succeeded"}
    if result is not None:
        body["result"] = result

    try:
        client = db._get_client()
        r = client.patch(
            f"{db.base}/pipeline_jobs",
            json=body,
            headers={**db.headers, "Prefer": "return=minimal"},
            params={"id": f"eq.{job_id}"},
        )
        r.raise_for_status()
        return True
    except Exception as e:
        log.warn("job_queue_succeed_failed", job_id=job_id, error=str(e)[:200])
        return False


# ─── fail ──────────────────────────────────────────────────────────────

def fail(
    job_id: str,
    error_message: str,
    retry_after_seconds: int = 60,
    error_code: str | None = None,
) -> bool:
    """Mark a job as failed.

    If attempts < max_attempts : reset status to 'pending' with run_after
    pushed forward by retry_after_seconds. The lease is cleared so any
    worker can reclaim it.

    If attempts >= max_attempts : flip to 'failed' AND insert a row into
    dead_letter_jobs (migration 025) for human triage.

    Returns True iff the database call(s) succeeded.
    """
    db = get_db()
    if db is None:
        return False

    # First, fetch the current row to check attempts/max_attempts. This
    # is one extra GET per failure — acceptable since failures should
    # be rare. The alternative (reading attempts from the claimed dict
    # the caller has) is fragile : callers may renew_lease mid-flight,
    # and the source of truth is the DB row.
    try:
        client = db._get_client()
        r = client.get(
            f"{db.base}/pipeline_jobs",
            params={
                "select": "id,type,entity_type,entity_id,payload,attempts,max_attempts",
                "id": f"eq.{job_id}",
            },
        )
        r.raise_for_status()
        rows = r.json() or []
        if not rows:
            log.warn("job_queue_fail_row_missing", job_id=job_id)
            return False
        row = rows[0]
    except Exception as e:
        log.warn("job_queue_fail_lookup_failed", job_id=job_id, error=str(e)[:200])
        return False

    attempts = int(row.get("attempts") or 0)
    max_attempts = int(row.get("max_attempts") or 3)
    error_truncated = (error_message or "")[:2000]

    if attempts < max_attempts:
        # Retryable — push back into 'pending' with future run_after.
        next_run = _now_utc() + timedelta(seconds=int(retry_after_seconds))
        body = {
            "status": "pending",
            "run_after": _isoformat(next_run),
            "locked_by": None,
            "locked_until": None,
            "last_error": error_truncated,
        }
        try:
            r = client.patch(
                f"{db.base}/pipeline_jobs",
                json=body,
                headers={**db.headers, "Prefer": "return=minimal"},
                params={"id": f"eq.{job_id}"},
            )
            r.raise_for_status()
            return True
        except Exception as e:
            log.warn("job_queue_fail_retry_patch_failed",
                     job_id=job_id, error=str(e)[:200])
            return False

    # Exhausted — promote to dead_letter_jobs AND mark failed.
    dlq_body = {
        "original_job_id": job_id,
        "type": row.get("type"),
        "entity_type": row.get("entity_type"),
        "entity_id": row.get("entity_id"),
        "payload": row.get("payload") or {},
        "error_code": error_code,
        "error_message": error_truncated,
        "attempts": attempts,
    }
    try:
        rdlq = client.post(
            f"{db.base}/dead_letter_jobs",
            json=dlq_body,
            headers={**db.headers, "Prefer": "return=minimal"},
        )
        # Don't hard-fail if DLQ insert errors — still flip the job to
        # 'failed' so the queue drains. Log loudly though.
        if rdlq.status_code >= 400:
            log.error(
                "job_queue_dlq_insert_failed",
                job_id=job_id, status=rdlq.status_code,
                body=(rdlq.text or "")[:200],
            )
    except Exception as e:
        log.error("job_queue_dlq_insert_threw",
                  job_id=job_id, error=str(e)[:200])

    body = {
        "status": "failed",
        "locked_by": None,
        "locked_until": None,
        "last_error": error_truncated,
    }
    try:
        r = client.patch(
            f"{db.base}/pipeline_jobs",
            json=body,
            headers={**db.headers, "Prefer": "return=minimal"},
            params={"id": f"eq.{job_id}"},
        )
        r.raise_for_status()
        log.warn(
            "job_queue_dead_lettered",
            job_id=job_id, type=row.get("type"),
            entity_id=row.get("entity_id"),
            attempts=attempts, error_code=error_code,
        )
        return True
    except Exception as e:
        log.warn("job_queue_fail_terminal_patch_failed",
                 job_id=job_id, error=str(e)[:200])
        return False


# ─── renew_lease ───────────────────────────────────────────────────────

def renew_lease(job_id: str, additional_seconds: int = 300) -> bool:
    """Push the lease deadline forward.

    Long-running jobs (full VOD download, big batched analyzer pass) call
    this periodically so another worker doesn't reclaim them.

    Sets locked_until = now() + additional_seconds (NOT old_locked_until +
    additional_seconds — we want a fresh window from "right now").
    """
    db = get_db()
    if db is None:
        return False

    new_until = _now_utc() + timedelta(seconds=int(additional_seconds))
    body = {"locked_until": _isoformat(new_until)}

    try:
        client = db._get_client()
        r = client.patch(
            f"{db.base}/pipeline_jobs",
            json=body,
            headers={**db.headers, "Prefer": "return=minimal"},
            params={"id": f"eq.{job_id}", "status": "eq.claimed"},
        )
        r.raise_for_status()
        return True
    except Exception as e:
        log.warn("job_queue_renew_failed", job_id=job_id, error=str(e)[:200])
        return False


# ─── get_active_count ──────────────────────────────────────────────────

def get_active_count(job_types: list[str]) -> int:
    """Count active ('pending' + 'claimed') jobs of the given types.

    Used by job_dispatcher and the analyzer/clipper backpressure path :
    don't enqueue more 'clip.create' jobs if 1000 are already pending.

    Uses PostgREST's exact-count header for precision.
    """
    db = get_db()
    if db is None:
        return 0
    if not job_types:
        return 0

    types_filter = "in.(" + ",".join(job_types) + ")"

    try:
        client = db._get_client()
        r = client.get(
            f"{db.base}/pipeline_jobs",
            params={
                "select": "id",
                "type": types_filter,
                "status": "in.(pending,claimed)",
                "limit": "1",  # we only need the header, not the rows
            },
            headers={**db.headers, "Prefer": "count=exact"},
        )
        r.raise_for_status()
        # PostgREST returns Content-Range : '0-0/N' (or '*/N' when limit=0)
        cr = r.headers.get("content-range") or ""
        if "/" in cr:
            tail = cr.split("/")[-1]
            if tail and tail != "*":
                try:
                    return int(tail)
                except ValueError:
                    pass
        return 0
    except Exception as e:
        log.warn("job_queue_count_failed", types=job_types, error=str(e)[:200])
        return 0


__all__ = [
    "enqueue",
    "claim",
    "succeed",
    "fail",
    "renew_lease",
    "get_active_count",
]
