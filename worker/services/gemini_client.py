"""Gemini 2.5 Flash-Lite client — video/text analysis."""

import json
import os
import time
import structlog
from config import config
from scheduler import scheduler

log = structlog.get_logger()


def _wait_for_file_active(genai_module, file_ref, timeout: int = 60) -> bool:
    """Poll until an uploaded file reaches ACTIVE state."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        f = genai_module.get_file(file_ref.name)
        state = getattr(f, "state", None)
        if state is None:
            return True  # older SDK without state tracking
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
    """Send prompt to Gemini. Returns parsed JSON or None."""
    if not config.GEMINI_API_KEY:
        return None

    can_call = await scheduler.wait_for("gemini")
    if not can_call:
        log.warn("gemini_quota_exceeded")
        return None

    try:
        import google.generativeai as genai  # type: ignore
        genai.configure(api_key=config.GEMINI_API_KEY)
        model_name = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite")
        model = genai.GenerativeModel(model_name)

        if video_path:
            video_file = genai.upload_file(video_path)
            # Wait for the file to become ACTIVE — Gemini processes uploads
            # asynchronously and returns 400 if we query before it's ready.
            if not _wait_for_file_active(genai, video_file):
                return None
            response = model.generate_content([prompt, video_file])
        else:
            response = model.generate_content(prompt)

        text = response.text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)

    except ImportError:
        log.warn("gemini_sdk_missing")
    except json.JSONDecodeError:
        log.warn("gemini_invalid_json")
    except Exception as e:
        log.error("gemini_error", error=str(e))

    return None
