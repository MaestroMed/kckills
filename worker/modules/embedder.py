"""
EMBEDDER — Compute Gemini text embeddings for published clips.

For each kill in status='published' AND embedding IS NULL :
    text = "{killer_champion} kills {victim_champion} | {ai_description} | tags: {tags}"
    vector = gemini.embed_content(model='models/text-embedding-004', content=text)
    safe_update kills.embedding = vector

Cost : ~$0.025 / 1M input tokens. ~50 tok/clip × 2021 clips ≈ 100K tok ≈ €0.002.
Daemon cadence : 30 min, batch of 50.

PR-arch P1 : queue-first via pipeline_jobs.
  * Claim `embedding.compute` jobs (entity_type='kill', entity_id=kill_id).
  * If empty, fall back to the legacy status='published' AND embedding IS NULL
    scan AND enqueue jobs for what we find — bridges the migration window.
  * On success : succeed(job_id, {"dim": len(vec)}).
  * On failure : fail(job_id, error, retry_after_seconds=300, error_code).
  * Lease : 60s (embedding is fast, usually <2s — Gemini call + a single
    PostgREST PATCH).
"""

from __future__ import annotations

import asyncio
import os
import structlog

from config import config
from scheduler import scheduler
from services import job_queue
from services.observability import run_logged
from services.supabase_client import safe_select, safe_update

log = structlog.get_logger()


EMBEDDING_MODEL = "models/gemini-embedding-001"
EMBEDDING_DIM = 768
BATCH_SIZE = 50
TASK_TYPE = "RETRIEVAL_DOCUMENT"
LEASE_SECONDS = 60
# Note : text-embedding-004 was deprecated 2026-04 and the API now returns
# 404 for it. gemini-embedding-001 is the current Google-recommended
# replacement, same 768-dim output by default (output_dimensionality=768),
# same RETRIEVAL_DOCUMENT task_type semantics. If we ever switch to the
# new google.genai SDK (the FutureWarning at module-import time), the
# call shape changes — see embedder_v2.py when it lands.


# Field set fetched per kill — kept narrow for egress.
_KILL_FIELDS = "id, killer_champion, victim_champion, ai_description, ai_tags, embedding"


def _build_embed_text(kill: dict) -> str:
    killer = kill.get("killer_champion") or "?"
    victim = kill.get("victim_champion") or "?"
    desc = (kill.get("ai_description") or "").strip()
    tags = kill.get("ai_tags") or []
    if not isinstance(tags, list):
        tags = []
    tags_str = ", ".join(str(t) for t in tags[:8]) or "none"
    text = f"{killer} kills {victim} | {desc} | tags: {tags_str}"
    return text[:1500]


async def embed_one(kill: dict) -> list[float] | None:
    can_call = await scheduler.wait_for("gemini")
    if not can_call:
        log.warn("embedder_quota_exceeded")
        return None

    text = _build_embed_text(kill)

    try:
        import google.generativeai as genai  # type: ignore
    except ImportError:
        log.warn("embedder_sdk_missing")
        return None

    try:
        genai.configure(api_key=config.GEMINI_API_KEY)
        result = await asyncio.to_thread(
            genai.embed_content,
            model=EMBEDDING_MODEL,
            content=text,
            task_type=TASK_TYPE,
            # gemini-embedding-001 defaults to 3072 dims — force 768
            # to match the kills.embedding column dimension. The Google
            # API accepts any value in {768, 1536, 3072} for this model.
            output_dimensionality=EMBEDDING_DIM,
        )
        emb = result.get("embedding") if isinstance(result, dict) else None
        if emb and isinstance(emb[0], list):
            emb = emb[0]
        if not emb or len(emb) != EMBEDDING_DIM:
            log.warn(
                "embedder_bad_shape",
                kill_id=kill.get("id", "?")[:8],
                got=len(emb) if emb else 0,
                expected=EMBEDDING_DIM,
            )
            return None
        return emb
    except Exception as e:
        log.error(
            "embedder_error",
            kill_id=kill.get("id", "?")[:8],
            error=str(e)[:200],
        )
        return None


def _format_vector(vec: list[float]) -> str:
    """Format Python list -> pgvector text literal."""
    return "[" + ",".join(f"{v:.7f}" for v in vec) + "]"


async def _process_kill(kill: dict, counters: dict) -> None:
    """Compute and persist embedding for one kill. Acks the attached
    pipeline job (if any) on success/fail.
    """
    job = kill.get("_pipeline_job")
    kid = kill["id"]

    # Cheap pre-filter — if the row already has an embedding (e.g. a
    # duplicate enqueue from a status race), succeed the job and bail.
    if kill.get("embedding") is not None:
        if job is not None:
            await asyncio.to_thread(
                job_queue.succeed, job["id"], {"already_embedded": True},
            )
        return

    # Quota guard before burning a Gemini call. The scheduler's wait_for
    # also enforces this, but checking first lets us back the job off
    # with a long retry instead of waiting on a drained quota.
    remaining = scheduler.get_remaining("gemini")
    if remaining is not None and remaining <= 0:
        log.warn("embedder_daily_quota_reached", kill_id=kid[:8])
        if job is not None:
            await asyncio.to_thread(
                job_queue.fail, job["id"],
                "gemini_daily_quota_reached", 7200, "gemini_quota",
            )
        return

    try:
        vec = await embed_one(kill)
    except Exception as e:
        log.error("embedder_exception", kill_id=kid[:8], error=str(e)[:200])
        if job is not None:
            await asyncio.to_thread(
                job_queue.fail, job["id"],
                f"embedder_exception: {type(e).__name__}",
                300, "embed_failed",
            )
        return

    if vec is None:
        if job is not None:
            await asyncio.to_thread(
                job_queue.fail, job["id"],
                "embed_returned_none", 300, "embed_failed",
            )
        return

    ok = safe_update(
        "kills",
        {"embedding": _format_vector(vec)},
        "id", kid,
    )
    if not ok:
        if job is not None:
            await asyncio.to_thread(
                job_queue.fail, job["id"],
                "supabase_update_failed", 300, "embed_failed",
            )
        return

    counters["embedded"] += 1
    if job is not None:
        await asyncio.to_thread(
            job_queue.succeed, job["id"], {"dim": len(vec)},
        )


@run_logged()
async def run() -> int:
    """Embedder main loop — queue-first, legacy scan as fallback.

    Order :
      1. Claim `embedding.compute` jobs from pipeline_jobs.
      2. If empty, fall back to scanning kills.status='published' AND
         embedding IS NULL AND enqueue jobs for what we find. Process
         them in this same pass so the migration window doesn't stall.
      3. On success : safe_update kills.embedding + succeed(job).
      4. On failure : fail(job, retry_after=300, error_code='embed_failed').
    """
    if not config.GEMINI_API_KEY:
        log.warn("embedder_no_api_key")
        return 0

    log.info("embedder_scan_start")

    worker_id = f"embedder-{os.getpid()}"

    # ─── 1. Queue-first claim ──────────────────────────────────────
    claimed = await asyncio.to_thread(
        job_queue.claim,
        worker_id,
        ["embedding.compute"],
        BATCH_SIZE,
        LEASE_SECONDS,
    )

    legacy_fallback_used = False
    work_kills: list[dict] = []

    for job in claimed:
        kill_id = job.get("entity_id")
        if not kill_id:
            await asyncio.to_thread(
                job_queue.fail, job["id"], "no entity_id on job",
                60, "bad_payload",
            )
            continue
        rows = safe_select("kills", _KILL_FIELDS, id=kill_id)
        if not rows:
            await asyncio.to_thread(
                job_queue.fail, job["id"], "kill row missing",
                3600, "kill_deleted",
            )
            continue
        rows[0]["_pipeline_job"] = job
        work_kills.append(rows[0])

    # ─── 2. Legacy fallback if queue was empty ────────────────────
    if not work_kills:
        legacy_fallback_used = True
        rows = safe_select(
            "kills", _KILL_FIELDS, status="published",
        )
        if not rows:
            return 0

        pending = [r for r in rows if r.get("embedding") is None]
        if not pending:
            log.info("embedder_no_pending")
            return 0

        pending = pending[:BATCH_SIZE]

        # Enqueue for next pass so subsequent runs go through the queue.
        # Idempotent via the unique index on (type, entity_type, entity_id).
        enqueued = 0
        for k in pending:
            jid = await asyncio.to_thread(
                job_queue.enqueue,
                "embedding.compute", "kill", k["id"],
                None, 50, None, 3,
            )
            if jid:
                enqueued += 1
        log.info(
            "embedder_legacy_fallback",
            processing=len(pending), enqueued_for_next_pass=enqueued,
        )
        work_kills = pending
    else:
        log.info(
            "embedder_queue", claimed=len(claimed), processing=len(work_kills),
        )

    # ─── 3. Process serially — embed_one is rate-limited by the
    # scheduler so concurrency wouldn't help here. Quota check inside
    # _process_kill stops the loop early on drain.
    counters = {"embedded": 0}
    for kill in work_kills:
        # Re-check quota each iteration — long passes can drain mid-batch.
        remaining = scheduler.get_remaining("gemini")
        if remaining is not None and remaining <= 0:
            log.warn(
                "embedder_daily_quota_reached_mid_batch",
                embedded=counters["embedded"],
                remaining_in_batch=len(work_kills) - counters["embedded"],
            )
            # Fail any remaining queued jobs with a long retry so they
            # come back tomorrow.
            for k in work_kills[counters["embedded"]:]:
                job = k.get("_pipeline_job")
                if job is not None:
                    await asyncio.to_thread(
                        job_queue.fail, job["id"],
                        "gemini_daily_quota_reached", 7200, "gemini_quota",
                    )
            break
        await _process_kill(kill, counters)

    log.info(
        "embedder_done",
        embedded=counters["embedded"],
        batch_size=len(work_kills),
        legacy_fallback=legacy_fallback_used,
    )
    return counters["embedded"]


if __name__ == "__main__":
    asyncio.run(run())
