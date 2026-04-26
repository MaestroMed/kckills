"""
MODERATOR — Claude Haiku 4.5 moderates comments before publication.

Each comment is classified as: approve, flag, or reject.
Trash talk between fans is OK. Toxicity, hate, harassment = reject.

PR-arch P2 (Wave 7) : queue-first via pipeline_jobs.
  * Claim `comment.moderate` jobs (entity_type='comment',
    entity_id=comment_id). The type was whitelisted in migration 033 +
    listed in queue_health.py but no module actually claimed it pre-Wave 7
    — moderation flowed exclusively through the legacy "scan
    moderation_status='pending'" loop.
  * If the queue is empty, fall back to the legacy scan AND opportunistically
    enqueue jobs for the rows we find — bridges the migration window so
    the new infra warms up without losing pending moderation work.
  * On success : moderate_comment() Haiku call → flip moderation_status
    + write toxicity_score, then succeed(job, {action,toxicity}).
  * On failure : fail(job, error, retry_after_seconds=300, error_code).
  * Lease : 60s (one Haiku call ~500ms + DB writes).
"""

import asyncio
import json
import os
import structlog
from scheduler import scheduler
from config import config
from services import job_queue
from services.observability import run_logged

log = structlog.get_logger()

MODERATION_PROMPT = """Modere ce commentaire sur un site de clips esport LoL.
Commentaire de "{username}": "{content}"
Reponds UNIQUEMENT en JSON: {{"action":"approve|flag|reject","reason":"...","toxicity":0.0-10.0}}
Regles: le trash talk leger entre fans est OK, les emojis et l'argot gaming sont OK.
reject = toxique, spam, haine, harcelement, contenu illegal.
flag = douteux, necessite review humain."""

# Worker-side knobs. Sized for the typical Wave 7 backlog (≤ 50 pending
# comments per cycle) — bigger batches just stretch the daemon's runtime
# without buying anything since Haiku is hard rate-limited at 1.5s/call
# inside the scheduler.
BATCH_SIZE = 25
LEASE_SECONDS = 60


async def moderate_comment(username: str, content: str) -> dict:
    """Moderate a comment. Returns {action, reason, toxicity}.

    Degraded modes :
      * No ANTHROPIC_API_KEY    → auto-approve (toxicity=0, reason=no_moderation_key)
      * Scheduler quota         → auto-approve (toxicity=0, reason=rate_limited)
      * anthropic SDK missing   → auto-approve (toxicity=0, reason=sdk_missing)
      * JSON parse error        → flag       (toxicity=5, reason=parse_error)
      * Any other exception     → auto-approve (toxicity=0, reason=error: <msg>)

    The "auto-approve on failure" choice is deliberate : the alternative
    (auto-reject) would silently censor users when our key is misconfigured
    or when Anthropic has an outage. Better to publish dubious content for
    a few minutes and let the user-triggered Report flow catch it than to
    lock people out of the comment system on every infra hiccup.
    """
    if not config.ANTHROPIC_API_KEY:
        # No API key → auto-approve (degraded mode)
        return {"action": "approve", "reason": "no_moderation_key", "toxicity": 0}

    can_call = await scheduler.wait_for("haiku")
    if not can_call:
        return {"action": "approve", "reason": "rate_limited", "toxicity": 0}

    prompt = MODERATION_PROMPT.format(username=username, content=content)

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        text = message.content[0].text.strip()
        result = json.loads(text)
        log.info("comment_moderated", action=result.get("action"), toxicity=result.get("toxicity"))
        return result

    except ImportError:
        log.warn("anthropic_sdk_not_installed")
        return {"action": "approve", "reason": "sdk_missing", "toxicity": 0}
    except json.JSONDecodeError:
        log.warn("haiku_invalid_json")
        return {"action": "flag", "reason": "parse_error", "toxicity": 5}
    except Exception as e:
        log.error("haiku_error", error=str(e))
        return {"action": "approve", "reason": f"error: {e}", "toxicity": 0}


# ─── Helpers ─────────────────────────────────────────────────────────

_NEW_STATUS_MAP = {
    "approve": "approved",
    "flag": "flagged",
    "reject": "rejected",
}


def _coerce_toxicity(raw) -> float | None:
    """Best-effort coerce of Haiku's `toxicity` field to float, else None.

    Haiku occasionally returns the score as a string ("7.5") or as a stray
    int — we accept both. NaN / Infinity / non-numeric strings yield None
    so the writer doesn't poison the column with a non-finite float.
    """
    if raw is None:
        return None
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    # Reject NaN / ±Infinity
    if val != val or val in (float("inf"), float("-inf")):
        return None
    return val


async def _process_comment(comment: dict, profile_lookup: dict) -> dict:
    """Run Haiku on a single comment row + write the resulting moderation
    state back to the comments table. Returns the result dict so callers
    can ack/fail their pipeline_jobs row from it.
    """
    from services.supabase_client import safe_update

    username = profile_lookup.get(comment.get("user_id"), "user")
    result = await moderate_comment(username, comment.get("content") or "")

    new_status = _NEW_STATUS_MAP.get(result.get("action"), "flagged")
    toxicity_val = _coerce_toxicity(result.get("toxicity"))

    patch = {
        "moderation_status": new_status,
        "moderation_reason": result.get("reason"),
    }
    if toxicity_val is not None:
        patch["toxicity_score"] = toxicity_val

    safe_update("comments", patch, "id", comment["id"])
    return result


# ─── Daemon loop ─────────────────────────────────────────────────────────


@run_logged()
async def run() -> int:
    """Process pending comment moderation work.

    Order :
      1. Claim `comment.moderate` jobs from pipeline_jobs (queue-first).
      2. If queue empty, fall back to scanning `comments WHERE
         moderation_status='pending' AND user_id IS NOT NULL` AND
         opportunistically enqueue them for the next cycle. This keeps the
         daemon useful while the rest of the pipeline migrates inserts to
         enqueue `comment.moderate` directly.
      3. For each comment : Haiku call → write moderation_status +
         toxicity_score + moderation_reason → ack the queue row.
    """
    from services.supabase_client import safe_select

    log.info("moderator_scan_start")

    worker_id = f"moderator-{os.getpid()}"

    # ─── 1. Queue-first claim ─────────────────────────────────────
    claimed = await asyncio.to_thread(
        job_queue.claim,
        worker_id,
        ["comment.moderate"],
        BATCH_SIZE,
        LEASE_SECONDS,
    )

    moderated = 0

    if claimed:
        # Resolve the comment rows referenced by the claimed jobs. We do
        # one batched select + one batched profiles lookup so a 25-job
        # batch makes 2 round trips to Supabase, not 50.
        comment_ids = [j.get("entity_id") for j in claimed if j.get("entity_id")]
        comments_by_id: dict[str, dict] = {}
        if comment_ids:
            # safe_select doesn't support `in.()` filters directly — we
            # fetch one-by-one (cheap : pending counts are typically
            # < 50/cycle and Supabase reads are 0.1s each on the local
            # network).
            for cid in comment_ids:
                rows = safe_select(
                    "comments",
                    "id, content, user_id, kill_id, moderation_status",
                    id=cid,
                )
                if rows:
                    comments_by_id[cid] = rows[0]

        profile_ids = list({
            c.get("user_id") for c in comments_by_id.values()
            if c.get("user_id")
        })
        profile_lookup: dict = {}
        if profile_ids:
            for pid in profile_ids:
                prows = safe_select("profiles", "id,discord_username", id=pid)
                if prows:
                    profile_lookup[pid] = prows[0].get("discord_username")

        for job in claimed:
            cid = job.get("entity_id")
            if not cid:
                await asyncio.to_thread(
                    job_queue.fail, job["id"], "no entity_id on job",
                    60, "bad_payload",
                )
                continue
            comment = comments_by_id.get(cid)
            if not comment:
                # Comment row missing (deleted by user, or job pre-dated
                # the row). Don't retry — this will never resolve.
                await asyncio.to_thread(
                    job_queue.fail, job["id"], "comment row missing",
                    3600, "comment_deleted",
                )
                continue
            # Idempotency : if the row was already moderated by the legacy
            # scan or another worker, skip the Haiku call and ack the job.
            if comment.get("moderation_status") and comment.get("moderation_status") != "pending":
                await asyncio.to_thread(
                    job_queue.succeed, job["id"],
                    {"skipped": "already_moderated"},
                )
                continue
            try:
                result = await _process_comment(comment, profile_lookup)
                await asyncio.to_thread(
                    job_queue.succeed, job["id"],
                    {
                        "action": result.get("action"),
                        "toxicity": result.get("toxicity"),
                    },
                )
                moderated += 1
            except Exception as e:
                # Don't crash the daemon — fail the job with a retry
                # window so the next cycle picks it up.
                log.error("moderator_job_failed", job_id=job["id"], error=str(e))
                await asyncio.to_thread(
                    job_queue.fail, job["id"], str(e)[:500], 300, "haiku_unexpected",
                )

    # ─── 2. Legacy fallback if queue was empty ────────────────────
    if not claimed:
        # Legacy path : scan the table for pending comments that haven't
        # been enqueued yet (the migration window).  We process them
        # AND enqueue a `comment.moderate` job so subsequent cycles can
        # claim through the queue path. The job_queue idempotency guard
        # (unique on type+entity_type+entity_id WHERE status active)
        # makes the enqueue a no-op if the row is already pending.
        pending = safe_select(
            "comments",
            "id, content, user_id, kill_id, moderation_status",
            moderation_status="pending",
        ) or []

        if not pending:
            log.info("moderator_scan_done", moderated=0, source="empty")
            return 0

        # Optional: fetch profiles for usernames. Best-effort — if it
        # fails we just call Haiku with username="user".
        profiles_raw = safe_select("profiles", "id,discord_username") or []
        profile_lookup = {p["id"]: p.get("discord_username") for p in profiles_raw}

        for comment in pending:
            try:
                await _process_comment(comment, profile_lookup)
                moderated += 1
            except Exception as e:
                log.error("moderator_legacy_failed",
                          comment_id=comment.get("id"), error=str(e))
                # Continue the loop — one bad comment doesn't kill the batch.

            # Bridge : enqueue for the queue-first path on the next cycle.
            # Idempotent — already-pending jobs no-op via the unique guard.
            try:
                await asyncio.to_thread(
                    job_queue.enqueue,
                    "comment.moderate",
                    "comment",
                    str(comment["id"]),
                    {"source": "legacy_bridge"},
                    50,
                )
            except Exception:
                # Enqueue failures are non-fatal — the legacy scan still
                # caught the row this cycle.
                pass

    log.info("moderator_scan_done", moderated=moderated,
             source="queue" if claimed else "legacy")
    return moderated
