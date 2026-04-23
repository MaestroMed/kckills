"""
QC_SAMPLER — Random sampling QC for published clips (timer drift detection).

Why : the clip_qc verifier (admin-triggered) catches timer drift > 30s
on individual clips, but admin only QCs clips that look suspicious. Most
drift goes undetected. This module enqueues `clip_qc.verify` jobs for a
small random sample of recently-published clips, so we get a continuous
quality signal without saturating the Gemini quota.

Pipeline :
  1. Query the latest 200 clips published in the last 7 days
  2. Filter out kills already QC'd in the last 30 days
  3. Random.sample N (default 5) and insert worker_jobs row each
  4. job_runner picks them up next cycle (30s), runs Gemini timer reading
  5. Result lands in worker_jobs.result. If drift > 30s → admin alert
     via watchdog later, OR auto-flag needs_reclip=true.

Quota math :
  - 5 jobs/cycle × 1 cycle/6h = 20 QC checks/day
  - Each ~1-2 Gemini calls = 20-40/day budget
  - Daily Gemini cap = 950 RPD (analyzer takes ~600/day)
  - Comfortable headroom.

Daemon interval : 6h. The job is idempotent — re-running just picks
new random samples. The dedup check ensures we don't re-QC the same kill.
"""

from __future__ import annotations

import json
import random
from datetime import datetime, timezone, timedelta

import httpx
import structlog

from services.supabase_client import get_db, safe_insert

log = structlog.get_logger()


# Tunables (kept conservative — Gemini quota is shared with analyzer)
SAMPLE_POOL_SIZE = 200          # how many recent clips we look at
SAMPLE_PICK_SIZE = 5            # how many we actually QC per cycle
RECENT_WINDOW_DAYS = 30         # only QC clips published in last 30d
                                # (worker has a backlog — newest clips
                                # may be days old. 30d keeps the pool
                                # large enough without re-QCing ancient
                                # clips that won't be re-clipped anyway)
DEDUP_WINDOW_DAYS = 60          # don't re-QC same kill within 60d


async def _fetch_recent_published(db) -> list[dict]:
    """Get latest published clips with a horizontal URL (required for QC)."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RECENT_WINDOW_DAYS)).isoformat()
    r = httpx.get(
        f"{db.base}/kills",
        headers=db.headers,
        params={
            "select": "id,created_at,clip_url_horizontal",
            "status": "eq.published",
            "clip_url_horizontal": "not.is.null",
            "created_at": f"gte.{cutoff}",
            "order": "created_at.desc",
            "limit": SAMPLE_POOL_SIZE,
        },
        timeout=15.0,
    )
    if r.status_code != 200:
        log.warn("qc_sampler_fetch_failed", status=r.status_code, body=r.text[:200])
        return []
    return r.json() or []


async def _fetch_already_qcd(db, kill_ids: list[str]) -> set[str]:
    """Find which of these kill_ids already have a recent clip_qc.verify job.

    Recent = within DEDUP_WINDOW_DAYS. Includes pending, running, completed,
    and failed jobs (failed are more likely to need a 2nd try, but not at
    the cost of doubling the Gemini quota — let admin retry manually).
    """
    if not kill_ids:
        return set()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=DEDUP_WINDOW_DAYS)).isoformat()
    # PostgREST: filter by kind=eq.clip_qc.verify and requested_at >= cutoff,
    # then pull the payload to inspect kill_id. Cheaper to over-fetch a bit
    # than to try a contains-array filter with JSONB casting via the REST API.
    # NB: worker_jobs uses `requested_at`, not `created_at` (migration 009).
    r = httpx.get(
        f"{db.base}/worker_jobs",
        headers=db.headers,
        params={
            "select": "payload",
            "kind": "eq.clip_qc.verify",
            "requested_at": f"gte.{cutoff}",
            "limit": 1000,
        },
        timeout=15.0,
    )
    if r.status_code != 200:
        log.warn("qc_sampler_dedup_query_failed", status=r.status_code)
        return set()
    rows = r.json() or []
    seen: set[str] = set()
    for row in rows:
        pl = row.get("payload") or {}
        kid = pl.get("kill_id") if isinstance(pl, dict) else None
        if kid:
            seen.add(kid)
    return seen


def _enqueue_qc_job(kill_id: str) -> str | None:
    """Insert a worker_jobs row for clip_qc.verify on this kill_id."""
    rec = safe_insert("worker_jobs", {
        "kind": "clip_qc.verify",
        "payload": {"kill_id": kill_id, "source": "qc_sampler"},
        "status": "pending",
    })
    if not rec:
        return None
    return rec.get("id") if isinstance(rec, dict) else None


# ─── Daemon entry point ──────────────────────────────────────────────────

async def run() -> int:
    """Sample N recently-published clips, enqueue clip_qc.verify jobs."""
    log.info("qc_sampler_start")

    db = get_db()
    if not db:
        return 0

    pool = await _fetch_recent_published(db)
    if not pool:
        log.info("qc_sampler_no_pool")
        return 0

    pool_ids = [r["id"] for r in pool if r.get("id")]
    already = await _fetch_already_qcd(db, pool_ids)
    eligible = [kid for kid in pool_ids if kid not in already]

    if not eligible:
        log.info(
            "qc_sampler_all_qcd",
            pool=len(pool_ids),
            already=len(already),
        )
        return 0

    pick = random.sample(eligible, k=min(SAMPLE_PICK_SIZE, len(eligible)))
    enqueued = 0
    for kid in pick:
        job_id = _enqueue_qc_job(kid)
        if job_id:
            enqueued += 1
            log.info("qc_sampler_enqueued", kill_id=kid[:8], job_id=job_id[:8])
        else:
            log.warn("qc_sampler_enqueue_failed", kill_id=kid[:8])

    log.info(
        "qc_sampler_done",
        pool=len(pool_ids),
        eligible=len(eligible),
        already_qcd=len(already),
        enqueued=enqueued,
    )
    return enqueued
