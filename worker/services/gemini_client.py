"""Gemini 2.5 Flash-Lite client — video/text analysis.

Wave 13f migration : moved from the deprecated `google-generativeai`
SDK to the modern `google-genai` (note the dash). The old SDK printed
a FutureWarning on every import ("All support has ended") and Google
has cut new-model support there. The new SDK exposes a `Client`
object instead of module-level globals, file uploads on
`client.files.upload`, and — critically — native structured-output
support via `responseSchema` (used by the analyzer to retire the
JSON-fence-stripping defensive layer).
"""

import asyncio
import json
import os
import time
import structlog
from config import config
from scheduler import scheduler

log = structlog.get_logger()


# ─── Wave 13f migration — shared client helpers ──────────────────────
# The new SDK uses a per-process `Client` object instead of the old
# `genai.configure()` global. We keep a single cached instance — the
# Client is thread-safe and holds the API key + transport pool, so
# instantiating it on every call would just leak HTTP connections.

_client = None


def get_client():
    """Return a shared `google.genai.Client` instance (created lazily).

    Returns None if the API key is missing OR the SDK is not installed,
    so callers can fall back to a degraded mode (text-only / no AI).
    """
    global _client
    if _client is not None:
        return _client
    if not config.GEMINI_API_KEY:
        return None
    try:
        from google import genai  # type: ignore
    except ImportError:
        log.warn("gemini_sdk_missing")
        return None
    _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


async def _wait_for_file_active(client, file_ref, timeout: int = 60) -> bool:
    """Poll until an uploaded file reaches ACTIVE state.

    Wave 27 (2026-05-08) — converted from sync `time.sleep(2)` to
    async with exponential backoff. The previous impl blocked the
    event loop for up to 60 s while waiting on Gemini's file ingest,
    starving every other coroutine (other clipper workers, dispatcher,
    heartbeat). Now it yields cleanly.

    Backoff schedule : 0.5 s, 1 s, 2 s, 4 s, 8 s, capped at 8 s. The
    typical small clip (~5 MB) goes ACTIVE in ~1.5 s, so the first
    two probes catch ~95 % of cases ; longer waits are paid only on
    bigger files / Gemini lag.

    Wave 13f migration : the first arg used to be the `genai` module
    (old SDK pattern with `genai.get_file(name)`). It's now a `Client`
    instance and we call `client.files.get(name=...)`. The signature
    change is intentional — every consumer in the worker was rewritten
    to pass the client through, and callers that still pass the module
    will fail loudly rather than silently using the deprecated API.
    """
    deadline = time.monotonic() + timeout
    backoff = 0.5
    while time.monotonic() < deadline:
        # `client.files.get` is a sync HTTP call ; wrap in to_thread so
        # we don't block the loop on the request itself.
        f = await asyncio.to_thread(client.files.get, name=file_ref.name)
        state = getattr(f, "state", None)
        if state is None:
            return True  # older SDK without state tracking (defensive)
        state_name = state.name if hasattr(state, "name") else str(state)
        if state_name == "ACTIVE":
            return True
        if state_name == "FAILED":
            log.warn("gemini_file_failed", name=file_ref.name)
            return False
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 8.0)
    log.warn("gemini_file_timeout", name=file_ref.name)
    return False


def _build_thinking_config(types_mod, model_name: str, budget: str | None):
    """Build a ThinkingConfig if the model + SDK support it. Returns None
    otherwise so the caller skips the kwarg entirely.

    Wave 33 — Gemini 3.5 Flash (GA 2026-05-19) introduced a string-enum
    thinking budget API : minimal | low | medium (default) | high. The
    google-genai SDK has shipped two signatures :

      types.ThinkingConfig(thinking_budget="medium")        # new (>= 0.x)
      types.ThinkingConfig(thinking_budget=1024)            # legacy int

    We try the string form first, fall back to a coarse int mapping, and
    finally return None (no thinking kwarg) so older SDK builds still
    work. Older models (3.1, 3-flash, 2.5-*) silently ignore the kwarg
    in the new SDK but raise on the old one — guard them out explicitly.
    """
    if not budget:
        return None
    # Only thinking-aware models benefit. Keep the allowlist tight so we
    # don't accidentally bill a 3.1-flash-lite call for a budget that
    # would inflate output tokens.
    THINKING_AWARE = ("gemini-3.5-",)
    if not any(model_name.startswith(p) for p in THINKING_AWARE):
        return None
    ThinkingConfig = getattr(types_mod, "ThinkingConfig", None)
    if ThinkingConfig is None:
        return None
    # 1) Try the new string-enum API.
    try:
        return ThinkingConfig(thinking_budget=budget)
    except Exception:
        pass
    # 2) Fall back to the legacy int budget. Map the four levels onto
    #    sensible token counts ; values picked from Google's pre-3.5
    #    "dynamic" recommendations.
    INT_MAP = {"minimal": 0, "low": 512, "medium": 1024, "high": 4096}
    try:
        return ThinkingConfig(thinking_budget=INT_MAP.get(budget, 1024))
    except Exception:
        return None


async def analyze(
    prompt: str,
    video_path: str | None = None,
    *,
    model: str | None = None,
    thinking_budget: str | None = None,
) -> dict | None:
    """Send prompt to Gemini. Returns parsed JSON or None.

    Wave 13f migration : the public surface is unchanged — callers
    (legacy or new) still get a `dict | None`. Internals now use the
    new SDK and request native JSON output via `responseMimeType` so
    we don't need the old code-fence stripping path. We still
    json.loads() defensively in case the model returns malformed
    JSON despite the MIME hint (rare but observed on flash-lite).

    Wave 33 additions :
      * `model` keyword — explicit model override. When None, falls back
        to the legacy `GEMINI_MODEL` env var (kept for back-compat).
        Per-stage callers should pass `config.GEMINI_MODEL_QC` /
        `_QUOTES` / `_OFFSET` / `_ANALYZER` explicitly so the resolved
        model is logged + costed correctly.
      * `thinking_budget` keyword — minimal | low | medium | high. Only
        applied to thinking-aware models (currently 3.5-flash). Older
        models receive no thinking config (the SDK ignores it on >=0.x).
    """
    if not config.GEMINI_API_KEY:
        return None

    can_call = await scheduler.wait_for("gemini")
    if not can_call:
        # Wave 20.1 — was a bare `gemini_quota_exceeded` log with no
        # context. Now surface remaining count + the daily reset hour
        # so the operator (or a Discord alert consumer) can tell at a
        # glance whether quota is just under the floor or actually 0,
        # and how long until 07:00 UTC reset.
        try:
            remaining = scheduler.get_remaining("gemini")
        except Exception:
            remaining = None
        log.warn(
            "gemini_quota_exhausted",
            remaining=remaining,
            reset_hour_utc=scheduler.QUOTA_RESET_HOUR_UTC,
        )
        return None

    client = get_client()
    if client is None:
        return None

    try:
        from google.genai import types  # type: ignore
        # Wave 33 — explicit `model` kwarg wins over the legacy env var
        # so per-stage callers can route premium tasks (analyzer for
        # high-score clips) to 3.5-flash without leaking that choice
        # into other concurrent calls via process-wide GEMINI_MODEL.
        model_name = (
            model
            or os.environ.get("GEMINI_MODEL")
            or "gemini-3.1-flash-lite"
        )

        if video_path:
            # Wave 13f migration — `client.files.upload(file=...)` instead
            # of `genai.upload_file(path=...)`. Pass the mime type via
            # the typed config so the API picks the right decoder.
            video_file = await asyncio.to_thread(
                client.files.upload,
                file=video_path,
                config=types.UploadFileConfig(mime_type="video/mp4"),
            )
            # Wait for the file to become ACTIVE — Gemini processes uploads
            # asynchronously and returns 400 if we query before it's ready.
            if not await _wait_for_file_active(client, video_file):
                return None
            contents = [prompt, video_file]
        else:
            contents = prompt

        # Wave 33 — build the generate_content config. Thinking budget
        # only attaches when the model supports it ; older models keep
        # the lean config they always had.
        gen_config_kwargs: dict = {
            "response_mime_type": "application/json",
        }
        thinking_cfg = _build_thinking_config(types, model_name, thinking_budget)
        if thinking_cfg is not None:
            gen_config_kwargs["thinking_config"] = thinking_cfg

        response = client.models.generate_content(
            model=model_name,
            contents=contents,
            config=types.GenerateContentConfig(**gen_config_kwargs),
        )

        text = (response.text or "").strip()
        # Defensive : even with response_mime_type=application/json the
        # model has been observed to occasionally wrap JSON in fences.
        # Wave 27.6 — use the shared strip_json_fence which handles
        # leading commentary, missing closing fence, and tilde fences
        # in addition to the simple ```json prefix the old code knew.
        from services.ai_providers._text_utils import strip_json_fence
        text = strip_json_fence(text)
        result = json.loads(text)
        # Wave 19.9 — surface usage_metadata + model name on the returned
        # dict so callers (notably services/ai_providers/gemini.py and
        # any future cost-tracking dashboard) can compute spend without
        # re-running the request. Mirrors the pattern in
        # modules/analyzer.py — additive keys prefixed with "_" so
        # existing consumers (qc.py reads "is_gameplay" / "timer") stay
        # unaffected.
        try:
            um = getattr(response, "usage_metadata", None)
            if um is not None and isinstance(result, dict):
                # Wave 27.6 — tolerate SDK field-name drift. The
                # google-genai SDK has shipped at least three variants
                # over the past year (prompt_token_count,
                # input_token_count, prompt_tokens) ; we read whichever
                # is present and fall back to None if none are.
                def _first(*names):
                    for n in names:
                        v = getattr(um, n, None)
                        if v is not None:
                            return v
                    return None
                result["_usage"] = {
                    "prompt_tokens": _first(
                        "prompt_token_count",
                        "input_token_count",
                        "prompt_tokens",
                        "input_tokens",
                    ),
                    "candidates_tokens": _first(
                        "candidates_token_count",
                        "output_token_count",
                        "candidates_tokens",
                        "output_tokens",
                    ),
                    "total_tokens": _first(
                        "total_token_count",
                        "total_tokens",
                    ),
                    # Wave 33 — cached input tokens (3.5 Flash exposes
                    # this when the implicit cache kicks in, 10× cheaper
                    # billing). Older models leave it at None.
                    "cached_content_tokens": _first(
                        "cached_content_token_count",
                        "cached_input_token_count",
                        "cached_tokens",
                    ),
                    # Tokens spent reasoning before producing the final
                    # answer — only populated on 3.5 Flash with a
                    # thinking_config set. Useful for tuning the budget.
                    "thoughts_tokens": _first(
                        "thoughts_token_count",
                        "reasoning_token_count",
                    ),
                }
                result["_model"] = model_name
                if thinking_budget:
                    result["_thinking_budget"] = thinking_budget
        except Exception:
            # Never let usage-extraction failure mask the actual result.
            pass
        return result

    except json.JSONDecodeError:
        log.warn("gemini_invalid_json")
    except Exception as e:
        log.error("gemini_error", error=str(e))

    return None
