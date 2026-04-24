"""
EMBEDDER — Compute Gemini text embeddings for published clips.

For each kill in status='published' AND embedding IS NULL :
    text = "{killer_champion} kills {victim_champion} | {ai_description} | tags: {tags}"
    vector = gemini.embed_content(model='models/text-embedding-004', content=text)
    safe_update kills.embedding = vector

Cost : ~$0.025 / 1M input tokens. ~50 tok/clip × 2021 clips ≈ 100K tok ≈ €0.002.
Daemon cadence : 30 min, batch of 50.
"""

from __future__ import annotations

import asyncio
import structlog

from config import config
from scheduler import scheduler
from services.observability import run_logged
from services.supabase_client import safe_select, safe_update

log = structlog.get_logger()


EMBEDDING_MODEL = "models/gemini-embedding-001"
EMBEDDING_DIM = 768
BATCH_SIZE = 50
TASK_TYPE = "RETRIEVAL_DOCUMENT"
# Note : text-embedding-004 was deprecated 2026-04 and the API now returns
# 404 for it. gemini-embedding-001 is the current Google-recommended
# replacement, same 768-dim output by default (output_dimensionality=768),
# same RETRIEVAL_DOCUMENT task_type semantics. If we ever switch to the
# new google.genai SDK (the FutureWarning at module-import time), the
# call shape changes — see embedder_v2.py when it lands.


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


@run_logged()
async def run() -> int:
    if not config.GEMINI_API_KEY:
        log.warn("embedder_no_api_key")
        return 0

    rows = safe_select(
        "kills",
        "id, killer_champion, victim_champion, ai_description, ai_tags, embedding",
        status="published",
    )
    if not rows:
        return 0

    pending = [r for r in rows if r.get("embedding") is None]
    if not pending:
        log.info("embedder_no_pending")
        return 0

    pending = pending[:BATCH_SIZE]
    log.info("embedder_start", batch=len(pending))

    embedded = 0
    for kill in pending:
        remaining = scheduler.get_remaining("gemini")
        if remaining is not None and remaining <= 0:
            log.warn("embedder_daily_quota_reached", embedded=embedded)
            break

        vec = await embed_one(kill)
        if vec is None:
            continue

        ok = safe_update(
            "kills",
            {"embedding": _format_vector(vec)},
            "id", kill["id"],
        )
        if ok:
            embedded += 1

    log.info("embedder_done", embedded=embedded, batch_size=len(pending))
    return embedded


if __name__ == "__main__":
    asyncio.run(run())
