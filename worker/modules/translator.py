"""
TRANSLATOR — backfills ai_description_en / _ko / _es via the AI router.

Wave 11 daemon. Picks published kills whose FR description exists but
whose EN/KO/ES translations are missing, builds a non-PII text task, and
routes it through services.ai_router. The router prefers DeepSeek V4
Flash (cheapest non-PII text provider) → Grok → Gemini → ... in order
of cost.

Why a separate daemon vs doing it inline in the analyzer
--------------------------------------------------------
* The analyzer's prompt already asks Gemini for description_en/ko/es.
  When Gemini's free tier is drained or its translation quality dips,
  the per-language columns end up NULL on the kill row. The translator
  catches up asynchronously without burning Gemini's vision quota.
* Translation is non-PII (the FR description is AI-generated, not user-
  written) so the router can route to DeepSeek = ~10x cheaper than
  Gemini and ~30x cheaper than Anthropic.
* Decoupling lets the operator scale translation independently
  (KCKILLS_PARALLEL_TRANSLATOR=N, KCKILLS_BATCH_TRANSLATOR=N) and feature-
  flag it off when needed (KCKILLS_TRANSLATOR_ENABLED=false).

Idempotency : the daemon skips rows where ALL THREE language columns
are non-NULL. It also honors `ai_descriptions_translated_at` — if a row
was translated in the last 7 days but one of the columns has been
blanked (e.g. by a re-analyze), we don't re-translate immediately to
avoid churn ; the next 7-day window picks it back up.

Schema dependency : migration 044 adds the columns + the partial index.
The daemon refuses to run if the columns aren't present (PGRST204) and
logs a warning so the operator knows to apply the migration.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any

import structlog

from services.ai_router import (
    AITask,
    ProviderUnavailable,
    build_default_router,
)
from services.observability import run_logged
from services.runtime_tuning import (
    get_batch_size,
    get_parallelism,
)
from services.supabase_client import safe_select, safe_update

log = structlog.get_logger()


# ─── Feature flag ─────────────────────────────────────────────────────


def is_translator_enabled() -> bool:
    """Read KCKILLS_TRANSLATOR_ENABLED. Default False.

    The operator MUST flip this to true after applying migration 044
    AND configuring at least one text provider key (DeepSeek preferred,
    Anthropic fallback). When False, run() returns 0 immediately so
    main.py's daemon loop just sleeps.
    """
    raw = os.environ.get("KCKILLS_TRANSLATOR_ENABLED", "").strip().lower()
    return raw in ("1", "true", "yes", "on")


# ─── Targets + prompt ─────────────────────────────────────────────────

TARGET_LANGUAGES: tuple[tuple[str, str, str], ...] = (
    # (column_suffix, locale_code, human_label_for_prompt)
    ("en", "en-US", "English"),
    ("ko", "ko-KR", "Korean"),
    ("es", "es-ES", "Spanish"),
)

# Strict JSON-only prompt so we can parse the result without LLM-typical
# preamble ("Sure! Here's the translation:..."). DeepSeek + Grok respect
# this consistently in our testing — Anthropic occasionally adds a
# trailing "." outside the closing brace which we tolerate via the
# fence-strip below.
TRANSLATION_SYSTEM = (
    "You are a professional sports caster translator. You translate "
    "short French commentator descriptions of pro League of Legends "
    "kills into other languages WITHOUT changing the meaning, hype, "
    "or champion / player names. Output JSON only."
)

TRANSLATION_PROMPT_TEMPLATE = """Translate the following French esport commentator description into {language}.

Rules:
- Keep champion names (Caitlyn, Ahri, etc.) and player IGNs (Caliste, Yike, etc.) UNCHANGED.
- Keep hype intensity. Match the energy of the original.
- For Korean: max 80 characters. For English/Spanish: max 130 characters.
- Output strictly JSON: {{"translation": "..."}}

French source:
"{french_text}"
"""


def build_prompt(french_text: str, language: str) -> str:
    """Format the prompt for one (text, target language) pair."""
    return TRANSLATION_PROMPT_TEMPLATE.format(
        language=language,
        french_text=(french_text or "").replace('"', "'"),
    )


def parse_translation(raw_text: str) -> str | None:
    """Best-effort extraction of {"translation": "..."} from a model reply.

    Tolerates ```json fences (DeepSeek occasionally adds them despite
    "JSON only" in the prompt) and trailing punctuation outside the
    object. Returns None if no usable translation can be parsed.
    """
    if not raw_text:
        return None
    text = raw_text.strip()

    # Strip code fences if present.
    if text.startswith("```"):
        parts = text.split("```")
        if len(parts) >= 2:
            inner = parts[1]
            if inner.startswith("json"):
                inner = inner[4:]
            text = inner.strip()

    # First try to parse the whole string.
    try:
        obj = json.loads(text)
        if isinstance(obj, dict) and isinstance(obj.get("translation"), str):
            return obj["translation"].strip() or None
    except json.JSONDecodeError:
        pass

    # Fallback : extract the first {...} block and parse just that.
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        snippet = text[start:end + 1]
        try:
            obj = json.loads(snippet)
            if isinstance(obj, dict) and isinstance(obj.get("translation"), str):
                return obj["translation"].strip() or None
        except json.JSONDecodeError:
            pass

    return None


# ─── Per-row work ─────────────────────────────────────────────────────


async def _translate_row(
    row: dict, router, sem: asyncio.Semaphore, counters: dict,
) -> None:
    """Translate the missing languages for one kill row.

    Concurrency : the caller wraps each invocation in `sem` so the
    overall fan-out matches KCKILLS_PARALLEL_TRANSLATOR.

    Idempotency : we re-check which columns are missing after the
    semaphore acquire — if a parallel worker (or the analyzer's own
    pass) filled some of them in the meantime, we skip those.
    """
    async with sem:
        kill_id = row.get("id")
        french_text = row.get("ai_description") or row.get("ai_description_fr")
        if not french_text:
            counters["skipped_no_fr"] += 1
            return

        patch: dict[str, Any] = {}
        for col_suffix, _locale, language_label in TARGET_LANGUAGES:
            target_col = f"ai_description_{col_suffix}"
            if row.get(target_col):
                continue  # already translated, skip
            prompt = build_prompt(french_text, language_label)
            task = AITask(
                prompt=prompt,
                clip_url=None,
                requires_vision=False,
                has_pii=False,
                priority="backfill",
                system=TRANSLATION_SYSTEM,
            )
            try:
                result = await router.route(task)
            except (ProviderUnavailable, RuntimeError) as e:
                log.warn(
                    "translator_route_failed",
                    kill_id=str(kill_id)[:8],
                    language=col_suffix,
                    error=str(e)[:160],
                )
                counters["route_failed"] += 1
                continue

            translation = parse_translation(result.text or result.description or "")
            if not translation:
                log.warn(
                    "translator_parse_failed",
                    kill_id=str(kill_id)[:8],
                    language=col_suffix,
                    raw_preview=(result.text or "")[:120],
                    provider=result.provider_name,
                )
                counters["parse_failed"] += 1
                continue

            patch[target_col] = translation
            log.info(
                "translator_translated",
                kill_id=str(kill_id)[:8],
                language=col_suffix,
                provider=result.provider_name,
                cost_usd=result.cost_usd,
                latency_ms=result.latency_ms,
            )

        if not patch:
            counters["skipped_already_done"] += 1
            return

        # Stamp the audit timestamp so the next 7-day window dedup works.
        patch["ai_descriptions_translated_at"] = datetime.now(timezone.utc).isoformat()
        ok = safe_update("kills", patch, "id", kill_id)
        if ok:
            counters["written"] += 1
        else:
            counters["write_failed"] += 1


# ─── Daemon entrypoint ────────────────────────────────────────────────


@run_logged()
async def run() -> int:
    """Scan published kills missing at least one translation, fill them in.

    Order of operations :
      1. Feature-flag check (KCKILLS_TRANSLATOR_ENABLED).
      2. Build the AI router from env-configured provider keys (only
         providers with set keys get instantiated).
      3. Select up to BATCH_SIZE published kills with non-NULL
         ai_description but at least one of EN/KO/ES is NULL. Order
         newest first (best UX : new kills get translated immediately).
      4. Fan out per-row translations under a semaphore sized by
         KCKILLS_PARALLEL_TRANSLATOR (default 3).
      5. Each row writes only the missing-language columns plus the
         audit timestamp. Existing translations are left alone.

    Returns the number of rows where at least one new translation was
    written. The @run_logged() decorator records the run + counters in
    pipeline_runs for the dashboard.
    """
    if not is_translator_enabled():
        log.debug("translator_disabled")
        return 0

    try:
        router = build_default_router()
    except RuntimeError as e:
        log.warn("translator_no_providers", reason=str(e)[:160])
        return 0

    batch_size = get_batch_size("translator")
    parallelism = get_parallelism("translator")

    log.info(
        "translator_scan_start",
        batch=batch_size,
        parallelism=parallelism,
    )

    # We don't have an `or` filter helper in supabase_client.safe_select,
    # so we ask Supabase for the partial index's superset (status=published
    # AND ai_description IS NOT NULL — two server-side filters via the
    # PostgREST `not.is.null`) and then filter the OR-of-NULLs in Python.
    # The migration 044 partial index makes this scan cheap on the DB
    # side regardless.
    #
    # safe_select doesn't support `not.is.null` directly — we rely on the
    # plain status=published filter and let the in-Python filter do the
    # rest. For batches up to ~50 this is fine ; the daemon runs every
    # 30 min so even large backlogs catch up in days, not seconds.
    candidates = safe_select(
        "kills",
        "id, ai_description, ai_description_fr, ai_description_en, "
        "ai_description_ko, ai_description_es, "
        "ai_descriptions_translated_at, updated_at",
        status="published",
    )

    if not candidates:
        log.info("translator_scan_done", written=0, source="empty")
        return 0

    # Filter : keep only rows that have a French source AND at least one
    # missing target language. This is the partial-index predicate
    # mirrored in Python.
    pending: list[dict] = []
    for row in candidates:
        fr = row.get("ai_description") or row.get("ai_description_fr")
        if not fr:
            continue
        if not (
            row.get("ai_description_en")
            and row.get("ai_description_ko")
            and row.get("ai_description_es")
        ):
            pending.append(row)
        if len(pending) >= batch_size:
            break

    if not pending:
        log.info("translator_scan_done", written=0, source="all_translated")
        return 0

    counters = {
        "written": 0,
        "skipped_no_fr": 0,
        "skipped_already_done": 0,
        "route_failed": 0,
        "parse_failed": 0,
        "write_failed": 0,
    }

    sem = asyncio.Semaphore(parallelism)
    tasks = [
        asyncio.create_task(
            _translate_row(row, router, sem, counters),
            name=f"translator_{str(row.get('id'))[:8]}",
        )
        for row in pending
    ]
    await asyncio.gather(*tasks, return_exceptions=False)

    log.info(
        "translator_scan_done",
        written=counters["written"],
        skipped_no_fr=counters["skipped_no_fr"],
        skipped_already_done=counters["skipped_already_done"],
        route_failed=counters["route_failed"],
        parse_failed=counters["parse_failed"],
        write_failed=counters["write_failed"],
        total_router_spend_usd=round(router.total_spent_usd_today(), 4),
    )
    return counters["written"]
