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


def _wait_for_file_active(client, file_ref, timeout: int = 60) -> bool:
    """Poll until an uploaded file reaches ACTIVE state.

    Wave 13f migration : the first arg used to be the `genai` module
    (old SDK pattern with `genai.get_file(name)`). It's now a `Client`
    instance and we call `client.files.get(name=...)`. The signature
    change is intentional — every consumer in the worker was rewritten
    to pass the client through, and callers that still pass the module
    will fail loudly rather than silently using the deprecated API.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        f = client.files.get(name=file_ref.name)
        state = getattr(f, "state", None)
        if state is None:
            return True  # older SDK without state tracking (defensive)
        state_name = state.name if hasattr(state, "name") else str(state)
        if state_name == "ACTIVE":
            return True
        if state_name == "FAILED":
            log.warn("gemini_file_failed", name=file_ref.name)
            return False
        time.sleep(2)
    log.warn("gemini_file_timeout", name=file_ref.name)
    return False


async def analyze(prompt: str, video_path: str | None = None) -> dict | None:
    """Send prompt to Gemini. Returns parsed JSON or None.

    Wave 13f migration : the public surface is unchanged — callers
    (legacy or new) still get a `dict | None`. Internals now use the
    new SDK and request native JSON output via `responseMimeType` so
    we don't need the old code-fence stripping path. We still
    json.loads() defensively in case the model returns malformed
    JSON despite the MIME hint (rare but observed on flash-lite).
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
        model_name = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite")

        if video_path:
            # Wave 13f migration — `client.files.upload(file=...)` instead
            # of `genai.upload_file(path=...)`. Pass the mime type via
            # the typed config so the API picks the right decoder.
            video_file = client.files.upload(
                file=video_path,
                config=types.UploadFileConfig(mime_type="video/mp4"),
            )
            # Wait for the file to become ACTIVE — Gemini processes uploads
            # asynchronously and returns 400 if we query before it's ready.
            if not _wait_for_file_active(client, video_file):
                return None
            contents = [prompt, video_file]
        else:
            contents = prompt

        response = client.models.generate_content(
            model=model_name,
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )

        text = (response.text or "").strip()
        # Defensive : even with response_mime_type=application/json the
        # model has been observed to occasionally wrap JSON in fences.
        # Strip them if present so downstream parsing doesn't fail.
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
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
                result["_usage"] = {
                    "prompt_tokens": getattr(um, "prompt_token_count", None),
                    "candidates_tokens": getattr(um, "candidates_token_count", None),
                    "total_tokens": getattr(um, "total_token_count", None),
                }
                result["_model"] = model_name
        except Exception:
            # Never let usage-extraction failure mask the actual result.
            pass
        return result

    except json.JSONDecodeError:
        log.warn("gemini_invalid_json")
    except Exception as e:
        log.error("gemini_error", error=str(e))

    return None
