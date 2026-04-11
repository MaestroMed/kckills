"""Gemini 2.5 Flash-Lite client — video/text analysis."""

import json
import structlog
from config import config
from scheduler import scheduler

log = structlog.get_logger()


async def analyze(prompt: str, video_path: str | None = None) -> dict | None:
    """Send prompt to Gemini. Returns parsed JSON or None."""
    if not config.GEMINI_API_KEY:
        return None

    can_call = await scheduler.wait_for("gemini")
    if not can_call:
        log.warn("gemini_quota_exceeded")
        return None

    try:
        import google.generativeai as genai
        genai.configure(api_key=config.GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-2.5-flash-lite")

        if video_path:
            video_file = genai.upload_file(video_path)
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
