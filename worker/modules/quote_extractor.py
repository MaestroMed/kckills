"""
QUOTE_EXTRACTOR — Wave 30f (2026-05-14)

Daemon module that feeds the "PHRASES CULTES" encyclopedia.

For every published KC kill clip that hasn't been processed yet :
    1. Download clip_url_horizontal to a local tmp file.
    2. Upload to Gemini via client.files.upload (mime_type=video/mp4).
    3. Wait for the file to reach ACTIVE state.
    4. Ask Gemini (3.1 Flash-Lite) to extract every shoutable caster
       phrase in the audio, with start_ms / end_ms / energy_level /
       caster_name / is_memetic / confidence.
    5. Persist the quotes via batched_safe_insert into kill_quotes.

The "already processed" filter is the LEFT-JOIN check on kill_quotes :
a kill is eligible iff NO kill_quotes row exists for it. There's no
flag column to maintain — the presence of rows IS the flag.

Cost model :
    Gemini Flash-Lite call ≈ $0.010-0.014 per clip (audio + video).
    Backfill 1,200 published clips ≈ $14.
    Steady-state : 5-15 new clips per match day → <$1/mo.

Rate limit :
    Single Gemini call per clip, gated by scheduler.wait_for("gemini")
    so we share the 15 RPM / 950 RPD budget with the analyzer, embedder,
    and offset-finder.

Hard cap :
    BATCH_SIZE from runtime_tuning ("quote_extractor"), default 20.
    Cycle interval default 1800s. With those defaults the module costs
    ≈ $0.25/cycle ≈ $12 if it runs every 30 min for 24h (which the
    LEFT-JOIN check prevents — it stops at zero candidates).
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

import httpx
import structlog

from config import config
from scheduler import scheduler
from services.observability import run_logged
from services.runtime_tuning import (
    get_batch_size,
    get_lease_seconds,
    get_parallelism,
)
from services.supabase_batch import batched_safe_insert
from services.supabase_client import get_db, safe_select

log = structlog.get_logger()


# ─── Versioning ────────────────────────────────────────────────────────
# Bump when the wording of QUOTE_EXTRACTION_PROMPT changes. Stored in
# raw_response payloads via the kill_quotes table's downstream consumers
# (not in a dedicated column — we don't need per-row provenance yet).
QUOTE_PROMPT_VERSION: str = "v1"

# ─── Tunables ──────────────────────────────────────────────────────────
BATCH_SIZE = get_batch_size("quote_extractor")
LEASE_SECONDS = get_lease_seconds("quote_extractor")
DOWNLOAD_WORKERS = get_parallelism("quote_extractor")

# Constraints checked client-side BEFORE insert so we don't waste a DB
# round-trip on quotes the CHECK constraint would reject anyway.
MIN_QUOTE_CHARS = 4
MAX_QUOTE_CHARS = 280
MAX_QUOTES_PER_CLIP = 12  # hard cap per kill so a verbose caster can't
                          # blow up a single row's storage footprint


# ─── Prompt ────────────────────────────────────────────────────────────
# French. The casters speak French. We want French extractions, including
# punctuation and casing reproduced as-spoken ("ABSOLUMENT INSANE LE
# BAILLEUL" stays uppercased — that's the energy signal in the original
# YouTube replay).

QUOTE_EXTRACTION_PROMPT = """<role>Tu es un transcripteur expert des casts LoL francophones (LEC, LFL, KCR replays). Tu connais le vocabulaire des commentateurs : Pomf, Drakos, Doigby, Trobi, Kameto, Eto, Reha, Coyote, Maghla, Doc.</role>

<task>Analyse l'audio de ce clip d'un match LoL pro et extrais TOUTES les phrases de caster qui meritent d'etre citees ("shoutable moments"). Un shoutable moment = phrase courte, energique, memorable, qu'un fan voudrait reciter ou ecrire en tatouage.</task>

<output_format>
Reponds UNIQUEMENT en JSON valide, structure exacte :
{
  "quotes": [
    {
      "text": "<phrase exacte du caster, max 280 caracteres, garde la casse originale si emphase>",
      "start_ms": <int, debut de la phrase en millisecondes depuis le debut du clip>,
      "end_ms": <int, fin de la phrase>,
      "caster_name": "<Pomf|Drakos|Doigby|Trobi|Kameto|Eto|Reha|Coyote|Maghla|Doc|null si inconnu>",
      "energy_level": <int 1-5 : 1=calme, 2=engage, 3=anime, 4=hype, 5=hurle/explosion vocale>,
      "is_memetic": <bool : true si phrase devenue meme communautaire ("ABSOLUMENT INSANE", "WHAT A PLAY", "GG WP", "CALISTE LE GOAT", etc.)>,
      "confidence": <float 0.0-1.0 : ta certitude sur la transcription et l'attribution>
    }
  ]
}
</output_format>

<rules>
1. AU MOINS 0, MAX 12 quotes. Si le clip n'a pas de moment shoutable (silence, son coupe, caster monotone), retourne {"quotes": []}.
2. Chaque quote DOIT etre 4-280 caracteres. Plus court = bruit. Plus long = pas une "phrase shoutable", c'est une analyse.
3. start_ms/end_ms en millisecondes depuis le debut du clip (0-40000 typique pour un clip de 40s). NE PAS confondre avec le timer in-game.
4. energy_level : sois honnete. 5 = hurlement, voix qui se casse, peak vocal. 1 = caster qui commente calmement. La plupart des quotes seront 3-4.
5. caster_name : seulement si tu reconnais clairement la voix. Sinon null. Ne devine pas.
6. is_memetic : true UNIQUEMENT pour les phrases deja virales chez les fans KC/LEC. "ABSOLUMENT INSANE", "QU'EST-CE QUE C'EST QUE", "PENTAKILL DE", "C'EST LA PROUVE", "LE TIMING", "OH MY GOD". Sois conservatif.
7. NE PAS inventer. Si tu n'entends pas, ne mets pas de quote. Mieux vaut 0 que 5 hallucinations.
8. Reproduis la casse comme entendu : si le caster crie "ABSOLUMENT INSANE", garde les majuscules. Si calme, casse normale.
9. JSON VALIDE uniquement. Pas de texte avant/apres. Pas de code fences.
</rules>

<examples_de_quotes_attendues>
- "ABSOLUMENT INSANE LE BAILLEUL"      (energy 5, memetic true)
- "PENTAKILL DE CALISTE"                (energy 5, memetic false)
- "QU'EST-CE QUE C'EST QUE CETTE OUTPLAY" (energy 5, memetic true)
- "Yike trouve le flank"                (energy 3, memetic false)
- "Canna est immortel sur Aatrox"       (energy 4, memetic false)
- "Le timing c'est de la chirurgie"     (energy 4, memetic true)
</examples_de_quotes_attendues>
"""


# ─── JSON schema (structured output) ───────────────────────────────────
# Gemini's responseSchema enforces the JSON shape so we don't need fence
# stripping or JSONDecodeError defenses on the happy path.

QUOTE_RESPONSE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "quotes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text":         {"type": "string"},
                    "start_ms":     {"type": "integer"},
                    "end_ms":       {"type": "integer"},
                    "caster_name":  {"type": "string"},
                    "energy_level": {"type": "integer"},
                    "is_memetic":   {"type": "boolean"},
                    "confidence":   {"type": "number"},
                },
                "required": ["text", "start_ms", "end_ms"],
            },
        },
    },
    "required": ["quotes"],
}


# ─── Eligibility scan ──────────────────────────────────────────────────

def _find_candidate_kills(limit: int) -> list[dict]:
    """Return kills eligible for quote extraction.

    A kill is eligible iff :
      * status='published'
      * clip_url_horizontal IS NOT NULL  (we transcribe audio from the
        16:9 clip — the 9:16 vertical is a crop, same audio track but
        smaller file)
      * ai_description IS NOT NULL  (Gemini already vetted this clip ;
        no point spending tokens on clips that failed analyzer QC)
      * NO row in kill_quotes for this kill_id  (= not processed)

    The LEFT-JOIN check is done via a NOT IN sub-select against the
    kill_quotes table. With ~1200 published kills and an empty
    kill_quotes (first run), this is one full-table scan ; subsequent
    runs scale linearly with the eligible-set size.

    We deliberately don't paginate this further — the BATCH_SIZE cap
    above bounds work per cycle, and the daemon cycle interval (1800s)
    bounds total cost.
    """
    db = get_db()
    if db is None:
        return []

    # Pull the already-processed kill IDs (one DB hit, set-membership
    # filter applied in Python). Avoids a complex PostgREST query that
    # would need a sub-select string we'd have to escape carefully.
    try:
        processed = safe_select("kill_quotes", "kill_id", _limit=10000)
        processed_ids = {row["kill_id"] for row in processed if row.get("kill_id")}
    except Exception as e:
        log.warn("quote_extractor_processed_query_failed", error=str(e)[:160])
        processed_ids = set()

    # Pull a candidate slate. We grab 3x the batch so the
    # "not in processed" filter still leaves enough rows after dedup.
    # 3x is a heuristic ; if the backlog is highly processed this might
    # under-fill but the next cycle picks up the rest.
    candidates_raw = safe_select(
        "kills",
        "id, clip_url_horizontal, killer_champion, victim_champion, "
        "ai_description, tracked_team_involvement, multi_kill, "
        "is_first_blood, highlight_score",
        status="published",
        _order="highlight_score.desc.nullslast",
        _limit=max(limit * 3, 60),
    )
    if not candidates_raw:
        return []

    eligible: list[dict] = []
    for row in candidates_raw:
        if not row.get("clip_url_horizontal"):
            continue
        if not row.get("ai_description"):
            continue
        if row["id"] in processed_ids:
            continue
        eligible.append(row)
        if len(eligible) >= limit:
            break
    return eligible


# ─── Per-clip Gemini call ──────────────────────────────────────────────

async def _download_clip(kill: dict, dest_dir: str) -> str | None:
    """Stream the horizontal clip to a local tmp file. Returns the path
    or None on failure (httpx error, 404, timeout).
    """
    clip_url = kill.get("clip_url_horizontal")
    if not clip_url:
        return None
    os.makedirs(dest_dir, exist_ok=True)
    path = os.path.join(dest_dir, f"quote_{kill['id'][:8]}.mp4")

    def _blocking() -> bool:
        try:
            with httpx.stream("GET", clip_url, follow_redirects=True, timeout=30) as r:
                r.raise_for_status()
                with open(path, "wb") as f:
                    for chunk in r.iter_bytes():
                        f.write(chunk)
            return True
        except Exception as e:
            log.warn(
                "quote_extractor_download_failed",
                kill_id=kill["id"][:8],
                error=str(e)[:120],
            )
            return False

    ok = await asyncio.to_thread(_blocking)
    return path if ok else None


def _cleanup_path(path: str | None) -> None:
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass


async def _extract_with_gemini(kill: dict, clip_path: str) -> list[dict] | None:
    """Run a single Gemini call. Returns the parsed quote list or None
    on failure (quota, malformed response, file-not-active).
    """
    can_call = await scheduler.wait_for("gemini")
    if not can_call:
        try:
            remaining = scheduler.get_remaining("gemini")
        except Exception:
            remaining = None
        log.warn(
            "quote_extractor_quota_exhausted",
            remaining=remaining,
            reset_hour_utc=scheduler.QUOTA_RESET_HOUR_UTC,
        )
        return None

    try:
        from services.gemini_client import get_client, _wait_for_file_active
        from google.genai import types  # type: ignore
    except ImportError:
        log.warn("quote_extractor_sdk_missing")
        return None

    client = get_client()
    if client is None:
        log.warn("quote_extractor_sdk_missing")
        return None

    model_name = getattr(config, "GEMINI_MODEL_QC", None) or os.environ.get(
        "GEMINI_MODEL", "gemini-3.1-flash-lite",
    )

    started_at = time.monotonic()
    text = ""
    try:
        video_file = await asyncio.to_thread(
            client.files.upload,
            file=clip_path,
            config=types.UploadFileConfig(mime_type="video/mp4"),
        )
        if not await _wait_for_file_active(client, video_file, timeout=60):
            log.warn("quote_extractor_file_not_active", kill_id=kill["id"][:8])
            return None

        gen_config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=QUOTE_RESPONSE_SCHEMA,
        )

        response = await asyncio.to_thread(
            client.models.generate_content,
            model=model_name,
            contents=[QUOTE_EXTRACTION_PROMPT, video_file],
            config=gen_config,
        )
        text = (response.text or "").strip()
        parsed = json.loads(text)
        quotes = parsed.get("quotes") or []
        if not isinstance(quotes, list):
            log.warn("quote_extractor_bad_shape", kill_id=kill["id"][:8])
            return None

        elapsed_ms = int((time.monotonic() - started_at) * 1000)
        log.info(
            "quote_extractor_gemini_done",
            kill_id=kill["id"][:8],
            quote_count=len(quotes),
            latency_ms=elapsed_ms,
            model=model_name,
        )
        return quotes
    except json.JSONDecodeError as e:
        log.warn(
            "quote_extractor_invalid_json",
            kill_id=kill["id"][:8],
            err=str(e)[:160],
            text_preview=text[:200],
        )
        return None
    except Exception as e:
        log.warn(
            "quote_extractor_gemini_error",
            kill_id=kill["id"][:8],
            error=str(e)[:200],
        )
        return None


# ─── Quote sanitation ──────────────────────────────────────────────────

def _normalize_quote(q: Any) -> dict | None:
    """Validate + canonicalize one quote dict. Returns the cleaned row
    ready for insert, or None if the quote should be dropped.
    """
    if not isinstance(q, dict):
        return None
    text = q.get("text")
    if not isinstance(text, str):
        return None
    text = text.strip()
    if len(text) < MIN_QUOTE_CHARS or len(text) > MAX_QUOTE_CHARS:
        return None

    try:
        start_ms = int(q.get("start_ms"))
        end_ms = int(q.get("end_ms"))
    except (TypeError, ValueError):
        return None
    if start_ms < 0:
        start_ms = 0
    if end_ms <= start_ms:
        # Clamp obviously bad ranges to a small window so the row still
        # passes the CHECK constraint. Better than dropping a legit
        # quote because Gemini fumbled the timing by a frame.
        end_ms = start_ms + 500

    caster = q.get("caster_name")
    if isinstance(caster, str):
        caster = caster.strip() or None
        # "null" string literal sneaks through occasionally
        if caster and caster.lower() == "null":
            caster = None
    else:
        caster = None

    energy = q.get("energy_level")
    try:
        energy = int(energy) if energy is not None else None
    except (TypeError, ValueError):
        energy = None
    if energy is not None:
        energy = max(1, min(5, energy))

    is_memetic = bool(q.get("is_memetic"))

    confidence = q.get("confidence")
    try:
        confidence = float(confidence) if confidence is not None else None
    except (TypeError, ValueError):
        confidence = None
    if confidence is not None:
        confidence = max(0.0, min(1.0, confidence))

    return {
        "quote_text":     text,
        "quote_start_ms": start_ms,
        "quote_end_ms":   end_ms,
        "caster_name":    caster,
        "language":       "fr",
        "energy_level":   energy,
        "is_memetic":     is_memetic,
        "ai_confidence":  confidence,
    }


# ─── Per-kill orchestration ───────────────────────────────────────────

async def _process_one(kill: dict, counters: dict) -> None:
    """Download → Gemini → insert. All bookkeeping logged via structlog."""
    clip_path = await _download_clip(kill, config.CLIPS_DIR)
    if clip_path is None:
        counters["download_failed"] += 1
        return

    try:
        quotes_raw = await _extract_with_gemini(kill, clip_path)
    finally:
        _cleanup_path(clip_path)

    if quotes_raw is None:
        counters["gemini_failed"] += 1
        return

    # Slice to the per-clip cap, sanitize, deduplicate by (start_ms, text).
    seen_keys: set[tuple[int, str]] = set()
    cleaned: list[dict] = []
    for raw in quotes_raw[:MAX_QUOTES_PER_CLIP]:
        nice = _normalize_quote(raw)
        if nice is None:
            continue
        key = (nice["quote_start_ms"], nice["quote_text"])
        if key in seen_keys:
            continue
        seen_keys.add(key)
        nice["kill_id"] = kill["id"]
        cleaned.append(nice)

    if not cleaned:
        counters["zero_quotes"] += 1
        log.info(
            "quotes_extracted",
            kill_id=kill["id"][:8],
            count=0,
            killer=kill.get("killer_champion"),
            victim=kill.get("victim_champion"),
        )
        return

    # batched_safe_insert is async + queues into the batched writer.
    # One row at a time keeps the conflict semantics simple (the UNIQUE
    # index on (kill_id, quote_start_ms, quote_text) drops dupes from a
    # re-run cleanly).
    inserted = 0
    for row in cleaned:
        try:
            await batched_safe_insert("kill_quotes", row)
            inserted += 1
        except Exception as e:
            log.warn(
                "quote_extractor_insert_failed",
                kill_id=kill["id"][:8],
                error=str(e)[:160],
            )

    counters["analysed"] += 1
    counters["quotes_total"] += inserted
    log.info(
        "quotes_extracted",
        kill_id=kill["id"][:8],
        count=inserted,
        killer=kill.get("killer_champion"),
        victim=kill.get("victim_champion"),
        prompt_version=QUOTE_PROMPT_VERSION,
    )


# ─── Daemon entrypoint ────────────────────────────────────────────────

@run_logged()
async def run() -> int:
    """One pass : claim BATCH_SIZE candidates and process them.

    The pass is internally pipelined : DOWNLOAD_WORKERS downloads in
    parallel, but the Gemini call is serialized via scheduler.wait_for
    ("gemini") — the 4s delay is what bounds throughput.

    Returns the count of kills that produced at least one inserted quote.
    """
    log.info("quote_extractor_scan_start", batch=BATCH_SIZE)
    kills = _find_candidate_kills(BATCH_SIZE)
    if not kills:
        log.info("quote_extractor_idle")
        return 0

    log.info("quote_extractor_candidates", count=len(kills))

    counters = {
        "analysed":        0,
        "zero_quotes":     0,
        "quotes_total":    0,
        "download_failed": 0,
        "gemini_failed":   0,
    }

    # Bounded parallelism on the download side. Gemini calls themselves
    # remain serialized via the scheduler — so even with workers=5 the
    # generate_content calls happen one-by-one. Parallelism mostly hides
    # download latency behind the Gemini wait.
    sem = asyncio.Semaphore(max(1, DOWNLOAD_WORKERS))

    async def _worker(kill: dict) -> None:
        async with sem:
            await _process_one(kill, counters)

    await asyncio.gather(*[_worker(k) for k in kills])

    log.info(
        "quote_extractor_scan_done",
        analysed=counters["analysed"],
        zero_quotes=counters["zero_quotes"],
        quotes_total=counters["quotes_total"],
        download_failed=counters["download_failed"],
        gemini_failed=counters["gemini_failed"],
    )
    return counters["analysed"]


if __name__ == "__main__":
    asyncio.run(run())
