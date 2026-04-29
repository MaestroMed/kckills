"""
OG_GENERATOR — Pre-generates Open Graph images with Pillow.

1200×630 PNG: dark gradient background, gold Cinzel text,
killer → victim, rating stars, description AI, event badge.
Uploaded to R2 at og/{kill_id}.png.

Exposes:
- generate_og_image(...) low-level Pillow helper
- run() daemon loop for kills in status='analyzed' that still lack an OG image

PR-arch P1 : queue-first via pipeline_jobs.
  * Claim `og.generate` jobs (entity_type='kill', entity_id=kill_id).
  * If empty, fall back to the legacy status='analyzed' scan AND enqueue
    jobs for what we find — bridges the migration window.
  * Quality gates (kill_visible, highlight_score, ai_description,
    needs_reclip) are applied AFTER claim — failing-gate jobs are
    succeeded with a {"skipped": "<reason>"} result so the queue moves
    on without retrying. They'll come back if/when admin flips the gate.
  * On success : upload OG → R2, safe_update kills.og_image_url +
    status='published', then succeed(job, {"r2_path": path}).
  * On failure : fail(job, error, retry_after_seconds=600,
    error_code='og_failed').
  * Lease : 120s (Pillow render + R2 upload).
"""

from __future__ import annotations

import asyncio
import os
import structlog

from PIL import Image, ImageDraw, ImageFont

from config import config
from services import job_queue, r2_client
from services.observability import run_logged
from services.supabase_batch import batched_safe_update, get_writer
from services.supabase_client import safe_select, safe_update

log = structlog.get_logger()

# Concurrent Pillow renders + R2 uploads. Pillow itself releases the GIL
# during compression, and R2 uploads are I/O-bound, so 4 workers parallelise
# cleanly on a 16-core box. Bumped from serial loop after observing ~10min
# for a backlog of 200 OG images at 1 worker.
CONCURRENCY = 4
BATCH_SIZE = 50
LEASE_SECONDS = 120

WIDTH = 1200
HEIGHT = 630
BG_COLOR = (1, 10, 19)            # --bg-primary
GOLD = (200, 170, 110)            # --gold
GOLD_BRIGHT = (240, 230, 210)     # --gold-bright
TEXT_PRIMARY = (240, 230, 210)
TEXT_MUTED = (123, 141, 181)
RED = (232, 64, 87)
BLUE_KC = (0, 87, 255)


# Field set fetched per kill — matches the legacy select so the gate
# logic and the Pillow render see identical inputs.
_KILL_FIELDS = (
    "id, killer_champion, victim_champion, ai_description, avg_rating, "
    "rating_count, multi_kill, og_image_url, status, needs_reclip, "
    "kill_visible, highlight_score"
)


def generate_og_image(
    kill_id: str,
    killer_name: str,
    killer_champion: str,
    victim_name: str,
    victim_champion: str,
    description: str = "",
    rating: float = 0,
    rating_count: int = 0,
    multi_kill: str | None = None,
    output_dir: str | None = None,
) -> str | None:
    """Generate an OG image and return the local file path."""
    out_dir = output_dir or config.THUMBNAILS_DIR
    os.makedirs(out_dir, exist_ok=True)
    output_path = os.path.join(out_dir, f"og_{kill_id}.png")

    try:
        img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
        draw = ImageDraw.Draw(img)

        # Subtle vertical gradient from BG → slightly warmer dark
        for y in range(HEIGHT):
            t = y / HEIGHT
            r = int(BG_COLOR[0] + (15 * (1 - t)))
            g = int(BG_COLOR[1] + (10 * (1 - t)))
            b = int(BG_COLOR[2] + (20 * (1 - t)))
            draw.line([(0, y), (WIDTH, y)], fill=(r, g, b))

        # Gold frame (top + left)
        draw.line([(0, 0), (WIDTH, 0)], fill=GOLD, width=3)
        draw.line([(0, 0), (0, HEIGHT)], fill=GOLD, width=3)
        draw.line([(0, HEIGHT - 1), (WIDTH, HEIGHT - 1)], fill=(60, 45, 20), width=1)

        font_title, font_sub, font_small = _load_fonts()

        # Multi-kill badge
        y_offset = 70
        if multi_kill:
            draw.text((60, y_offset), multi_kill.upper(), fill=GOLD_BRIGHT, font=font_sub)
            y_offset += 50

        # Killer line
        killer_text = f"{killer_name} · {killer_champion}"
        draw.text((60, y_offset), killer_text, fill=GOLD, font=font_title)
        y_offset += 70

        draw.text((60, y_offset), "eliminates", fill=TEXT_MUTED, font=font_sub)
        y_offset += 45

        victim_text = f"{victim_name} · {victim_champion}"
        draw.text((60, y_offset), victim_text, fill=RED, font=font_title)
        y_offset += 85

        if description:
            draw.text((60, y_offset), description[:100], fill=TEXT_PRIMARY, font=font_sub)
            y_offset += 45

        if rating and rating > 0:
            stars = "★" * int(round(rating)) + "☆" * (5 - int(round(rating)))
            rating_text = f"{stars}  {rating:.1f} ({rating_count} votes)"
            draw.text((60, y_offset), rating_text, fill=GOLD, font=font_small)

        # Branding footer
        draw.text((60, HEIGHT - 60), "KCKILLS", fill=GOLD, font=font_sub)
        draw.text((220, HEIGHT - 55), "Every Kill. Rated. Remembered.", fill=TEXT_MUTED, font=font_small)

        img.save(output_path, "PNG", optimize=True)
        log.info("og_generated", kill_id=kill_id, path=output_path)
        return output_path

    except Exception as e:
        log.error("og_generation_failed", kill_id=kill_id, error=str(e))
        return None


def _load_fonts():
    """Best-effort: try to load bundled fonts, fall back to Pillow default."""
    try:
        return (
            ImageFont.truetype("Cinzel-Bold.ttf", 52),
            ImageFont.truetype("FiraSans-Regular.ttf", 28),
            ImageFont.truetype("FiraSans-Regular.ttf", 20),
        )
    except Exception:
        pass
    try:
        # DejaVu ships with most Linux distros and python:3.12-slim
        return (
            ImageFont.truetype("DejaVuSans-Bold.ttf", 52),
            ImageFont.truetype("DejaVuSans.ttf", 28),
            ImageFont.truetype("DejaVuSans.ttf", 20),
        )
    except Exception:
        default = ImageFont.load_default()
        return default, default, default


# ─── Quality gate ──────────────────────────────────────────────────────

def _gate_reason(kill: dict) -> str | None:
    """Return a string reason if the kill fails the publish quality gates,
    or None if it should proceed.

    Mirrors the legacy filters (skipped_invisible / skipped_low_score /
    skipped_no_desc / skipped_needs_reclip) so the queue path produces
    the same publish set as the scan path.

    PR-arch P3 (og_refresher) — also gate on killer_champion +
    victim_champion. The Pillow render expects both as non-empty strings
    and would otherwise emit "KC · ?" / "Opponent · ?" placeholders that
    look broken on Twitter / Discord cards. Treat empty/None as a soft
    skip — the og_refresher will re-enqueue these once the harvester
    fills the missing fields.
    """
    if kill.get("needs_reclip") is True:
        return "needs_reclip"
    if kill.get("kill_visible") is False:        # TRUE or NULL passes
        return "kill_invisible"
    hs = kill.get("highlight_score")
    if hs is not None and hs < 3.0:
        return "low_highlight_score"
    if not (kill.get("killer_champion") or "").strip():
        return "no_killer_champion"
    if not (kill.get("victim_champion") or "").strip():
        return "no_victim_champion"
    if not kill.get("ai_description"):
        return "no_description"
    return None


# ─── Per-kill processor ────────────────────────────────────────────────

async def _process_kill(kill: dict, counters: dict, sem: asyncio.Semaphore) -> None:
    """Render, upload and persist the OG image for one kill. Acks the
    attached pipeline job (if any) on success/skip/fail.
    """
    job = kill.get("_pipeline_job")

    async with sem:
        kid = kill["id"]

        # Already-has-OG fast path — flip status and ack.
        if kill.get("og_image_url"):
            ok = safe_update("kills", {"status": "published"}, "id", kid)
            counters["status_only"] += 1
            if job is not None:
                if ok:
                    await asyncio.to_thread(
                        job_queue.succeed, job["id"],
                        {"r2_path": kill.get("og_image_url"), "skipped": "already_uploaded"},
                    )
                else:
                    await asyncio.to_thread(
                        job_queue.fail, job["id"],
                        "status_flip_failed", 600, "og_failed",
                    )
            return

        # Pillow render runs CPU-bound; offload to a thread so the
        # event loop can keep firing the other workers' R2 uploads.
        local_path = await asyncio.to_thread(
            generate_og_image,
            kill_id=kid,
            killer_name=kill.get("killer_name") or "KC",
            killer_champion=kill.get("killer_champion") or "?",
            victim_name=kill.get("victim_name") or "Opponent",
            victim_champion=kill.get("victim_champion") or "?",
            description=kill.get("ai_description") or "",
            rating=float(kill.get("avg_rating") or 0),
            rating_count=int(kill.get("rating_count") or 0),
            multi_kill=kill.get("multi_kill"),
        )
        if not local_path:
            counters["skipped"] += 1
            if job is not None:
                await asyncio.to_thread(
                    job_queue.fail, job["id"],
                    "pillow_render_failed", 600, "og_failed",
                )
            return

        og_url = await r2_client.upload_og(kid, local_path)
        patch = {"status": "published"}
        if og_url:
            patch["og_image_url"] = og_url
        ok = safe_update("kills", patch, "id", kid)
        try:
            os.remove(local_path)
        except Exception:
            pass

        if not ok:
            counters["skipped"] += 1
            if job is not None:
                await asyncio.to_thread(
                    job_queue.fail, job["id"],
                    "supabase_update_failed", 600, "og_failed",
                )
            return

        counters["generated"] += 1
        if job is not None:
            if og_url:
                await asyncio.to_thread(
                    job_queue.succeed, job["id"], {"r2_path": og_url},
                )
            else:
                # Status flipped but R2 upload failed — fail the job so
                # we retry the upload later. Status will idempotently
                # remain 'published' when the retry succeeds.
                await asyncio.to_thread(
                    job_queue.fail, job["id"],
                    "r2_upload_failed", 600, "og_failed",
                )


# ─── Daemon loop ────────────────────────────────────────────────────────────

@run_logged()
async def run() -> int:
    """Generate OG images for analysed kills that don't have one yet.

    Order :
      1. Claim `og.generate` jobs from pipeline_jobs.
      2. Apply quality gates per kill — failing-gate jobs are succeeded
         with skipped=<reason> so the queue doesn't retry them.
      3. If queue empty, fall back to the legacy status='analyzed' scan
         AND enqueue jobs for what we find. Process them in this same
         pass so the migration window doesn't stall.
      4. Render + R2 upload + flip status='published' + ack job.
    """
    log.info("og_generator_scan_start")

    worker_id = f"og_generator-{os.getpid()}"

    # ─── 1. Queue-first claim ──────────────────────────────────────
    claimed = await asyncio.to_thread(
        job_queue.claim,
        worker_id,
        ["og.generate"],
        BATCH_SIZE,
        LEASE_SECONDS,
    )

    legacy_fallback_used = False
    work_kills: list[dict] = []
    skipped_gate = {
        "needs_reclip": 0,
        "kill_invisible": 0,
        "low_highlight_score": 0,
        "no_description": 0,
        "no_killer_champion": 0,
        "no_victim_champion": 0,
    }

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
        kill = rows[0]
        # Pre-claim filters : same logic as the legacy scan but evaluated
        # per-row. Failing the gate succeeds the job with skipped=reason
        # so the queue moves on instead of burning retries on a row that
        # admin needs to manually unblock.
        gate = _gate_reason(kill)
        if gate is not None:
            skipped_gate[gate] = skipped_gate.get(gate, 0) + 1
            await asyncio.to_thread(
                job_queue.succeed, job["id"], {"skipped": gate},
            )
            continue
        kill["_pipeline_job"] = job
        work_kills.append(kill)

    # ─── 2. Legacy fallback if queue was empty ────────────────────
    if not work_kills and not claimed:
        legacy_fallback_used = True

        kills = safe_select("kills", _KILL_FIELDS, status="analyzed")
        if not kills:
            log.info("og_generator_scan_done", generated=0)
            return 0

        # PR8 — skip kills marked as needs_reclip=true. These are quarantined
        # clips (e.g. from the offset=0 bug) that should NOT be re-published
        # until the clipper produces a corrected version.
        skipped_needs_reclip = sum(1 for k in kills if k.get("needs_reclip") is True)
        kills = [k for k in kills if k.get("needs_reclip") is not True]

        # PR11 — HARD QUALITY GATES. Only publish clips that pass all of :
        #   1. kill_visible == True   (Gemini saw the kill happen on screen,
        #                              not a caster cam / map view / replay menu)
        #   2. highlight_score >= 3.0 (filters out the ai-rated flatliners)
        #   3. ai_description present (already enforced by analyzer, but the
        #                              field can be NULL from older legacy rows)
        # Anything failing these gates stays in status='analyzed' until
        # admin manually marks it qc_human_approved=TRUE via the upcoming
        # PR6-E /admin/events dashboard.
        pre_count = len(kills)
        skipped_invisible = sum(1 for k in kills if k.get("kill_visible") is False)
        skipped_low_score = sum(
            1 for k in kills
            if k.get("highlight_score") is not None and k["highlight_score"] < 3.0
        )
        skipped_no_desc = sum(1 for k in kills if not k.get("ai_description"))
        kills = [
            k for k in kills
            if k.get("kill_visible") is not False           # TRUE or NULL passes
            and (k.get("highlight_score") is None or k["highlight_score"] >= 3.0)
            and k.get("ai_description")
        ]
        skipped_quality = pre_count - len(kills)

        if skipped_needs_reclip or skipped_quality:
            log.info(
                "og_generator_quality_gate",
                skipped_needs_reclip=skipped_needs_reclip,
                skipped_invisible=skipped_invisible,
                skipped_low_score=skipped_low_score,
                skipped_no_desc=skipped_no_desc,
                kept=len(kills),
            )
        if not kills:
            log.info("og_generator_scan_done", generated=0,
                     skipped_needs_reclip=skipped_needs_reclip,
                     skipped_quality=skipped_quality)
            return 0

        kills = kills[:BATCH_SIZE]

        # Enqueue every legacy-found kill so subsequent passes go through
        # the queue. Idempotent via the unique index on (type, entity_type,
        # entity_id) WHERE active.
        enqueued = 0
        for k in kills:
            jid = await asyncio.to_thread(
                job_queue.enqueue,
                "og.generate", "kill", k["id"],
                None, 50, None, 3,
            )
            if jid:
                enqueued += 1

        # Fast-path : kills that already have og_image_url just need a
        # status flip. PR10-A2: batched_safe_update collapses ALL of them
        # into ONE PostgREST PATCH (id=in.(...)) since the body is identical
        # — was 340 serial PATCHes (~5min), now ~1 second.
        already = [k for k in kills if k.get("og_image_url")]
        todo = [k for k in kills if not k.get("og_image_url")]
        if already:
            await get_writer().start_background_flusher()
            for k in already:
                await batched_safe_update("kills", {"status": "published"}, "id", k["id"])
            await get_writer().flush_now()

        log.info(
            "og_generator_legacy_fallback",
            processing=len(todo), status_only=len(already),
            enqueued_for_next_pass=enqueued,
        )
        work_kills = todo
    elif work_kills:
        log.info(
            "og_generator_queue",
            claimed=len(claimed), processing=len(work_kills),
            skipped_gate=skipped_gate,
        )

    if not work_kills:
        # All claimed jobs were gate-skipped — log that and exit.
        if claimed:
            log.info(
                "og_generator_scan_done",
                generated=0, claimed=len(claimed),
                skipped_gate=skipped_gate,
            )
        return 0

    # ─── 3. Render + upload + persist (parallel) ───────────────────
    sem = asyncio.Semaphore(CONCURRENCY)
    counters = {"generated": 0, "skipped": 0, "status_only": 0}

    # Wave 13f: TaskGroup fan-out — _process_kill has no top-level try/except,
    # so an unexpected exception (e.g. R2 outage) used to crash the gather and
    # leave sibling tasks orphaned. TaskGroup propagates fail-fast as an
    # ExceptionGroup AND cancels siblings cleanly, releasing the semaphore +
    # any in-flight HTTP connections.
    async with asyncio.TaskGroup() as tg:
        for k in work_kills:
            tg.create_task(_process_kill(k, counters, sem))

    log.info(
        "og_generator_scan_done",
        generated=counters["generated"],
        skipped=counters["skipped"],
        status_only=counters["status_only"],
        legacy_fallback=legacy_fallback_used,
    )
    return counters["generated"]
