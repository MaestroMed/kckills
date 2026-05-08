"""
captions — V41 (Wave 26.1).

Auto-generates a French SRT/VTT caption track per published clip by
piping the clip's audio through a transcription model. Stages :

    1. Pull the next batch of `kills` rows where status='published'
       AND no row exists in `kill_captions` for language='fr'.
    2. Download the horizontal MP4 from R2 (cached to disk for
       re-runs).
    3. Extract audio to a 16 kHz mono WAV via ffmpeg.
    4. Send to Gemini 3.1 Flash-Lite with a "transcribe + segment"
       prompt — the analyser is already on the daemon's hot path
       so we reuse the same client.
    5. Upload the .vtt to R2 (`captions/<kill_id>.vtt`).
    6. Insert a row into `kill_captions`.

Idempotent : if a caption already exists for (kill_id, fr) we skip.

Currently a SCAFFOLD — the real implementation needs :
    * the `kill_captions` table (migration 058 — applied separately).
    * an R2 bucket policy for `captions/*`.
    * a Gemini prompt template tuned for esports caster cuts.
    * the `<track kind="captions" srclang="fr">` wiring in
      FeedPlayerPool (V41b).

Ship plan : run for 1 week behind a feature flag
`KCKILLS_CAPTIONS_ENABLED=1` ; QA the SRT quality on 20 clips ;
flip on by default.
"""

from __future__ import annotations

import asyncio
import os
import structlog
from typing import Any

from config import config
from scheduler import scheduler
from services import gemini_client, r2_client
from services.observability import run_logged
from services.supabase_client import safe_select, supabase_table_insert

log = structlog.get_logger()

CAPTIONS_BUCKET_PREFIX = "captions/"
BATCH_SIZE = 5
LANGUAGE = "fr"


@run_logged()
async def run() -> dict[str, Any]:
    """One pass of the captions pipeline. Returns counters for the
    daily Discord report."""
    if os.environ.get("KCKILLS_CAPTIONS_ENABLED", "") != "1":
        log.debug("captions_module_disabled")
        return {"items_scanned": 0, "items_processed": 0, "items_skipped": 0}

    db_check = safe_select("kill_captions", "id", limit=1)
    if db_check is None:
        # Table missing — migration 058 not applied yet. Skip silently.
        log.warn("captions_table_missing")
        return {"items_scanned": 0, "items_processed": 0, "items_skipped": 0}

    # Find published kills without an FR caption yet.
    candidates = safe_select(
        "kills",
        "id, clip_url_horizontal, hls_master_url",
        status="eq.published",
        limit=str(BATCH_SIZE * 4),
    ) or []
    if not candidates:
        return {"items_scanned": 0, "items_processed": 0, "items_skipped": 0}

    processed = 0
    skipped = 0
    failed = 0
    for kill in candidates[:BATCH_SIZE]:
        kid = kill.get("id")
        if not kid:
            continue
        # Skip if already captioned.
        existing = safe_select(
            "kill_captions",
            "id",
            kill_id=f"eq.{kid}",
            language=f"eq.{LANGUAGE}",
            limit="1",
        ) or []
        if existing:
            skipped += 1
            continue
        clip_url = kill.get("clip_url_horizontal")
        if not clip_url:
            skipped += 1
            continue
        try:
            srt = await _transcribe_clip(clip_url)
            if not srt:
                failed += 1
                continue
            # Upload to R2.
            r2_path = f"{CAPTIONS_BUCKET_PREFIX}{kid}.vtt"
            await asyncio.to_thread(
                r2_client.upload_bytes,
                r2_path,
                srt.encode("utf-8"),
                "text/vtt",
            )
            vtt_url = f"{config.R2_PUBLIC_URL}/{r2_path}"
            # Persist row.
            await asyncio.to_thread(
                supabase_table_insert,
                "kill_captions",
                {
                    "kill_id": kid,
                    "language": LANGUAGE,
                    "text": srt,
                    "vtt_url": vtt_url,
                    "model": "gemini-3.1-flash-lite",
                },
            )
            processed += 1
        except Exception as e:
            log.warn("captions_failed", kill_id=kid, error=str(e)[:160])
            failed += 1

    return {
        "items_scanned": len(candidates[:BATCH_SIZE]),
        "items_processed": processed,
        "items_skipped": skipped,
        "items_failed": failed,
    }


async def _transcribe_clip(clip_url: str) -> str | None:
    """Send the clip audio to Gemini and ask for a VTT-format
    transcription. Returns a WebVTT-format string ready for upload,
    or None on failure."""
    can_call = await scheduler.wait_for("gemini")
    if not can_call:
        log.warn("captions_gemini_quota_exhausted")
        return None
    prompt = (
        "Transcrible the French commentary audio of this LoL clip.\n"
        "Return a strict WebVTT format (no JSON, no Markdown) with at "
        "most 2 seconds per cue. Empty cues are allowed for silence.\n"
        "Format:\n"
        "WEBVTT\n\n"
        "00:00.000 --> 00:02.000\n"
        "(line)\n"
    )
    try:
        result = await gemini_client.analyze(prompt, video_path=clip_url)
        # The analyser returns a parsed JSON dict by default ; for
        # this prompt the model returns plain text in result['text'].
        if isinstance(result, dict):
            return result.get("text") if isinstance(result.get("text"), str) else None
        return None
    except Exception as e:
        log.warn("captions_transcribe_failed", error=str(e)[:160])
        return None
