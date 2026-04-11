"""Claude Haiku 4.5 client — comment moderation."""

import json
import structlog
from config import config
from scheduler import scheduler

log = structlog.get_logger()


async def moderate(prompt: str) -> dict | None:
    """Send moderation prompt to Haiku. Returns parsed JSON or None."""
    if not config.ANTHROPIC_API_KEY:
        return None

    can_call = await scheduler.wait_for("haiku")
    if not can_call:
        return None

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        text = message.content[0].text.strip()
        return json.loads(text)

    except ImportError:
        log.warn("anthropic_sdk_missing")
    except json.JSONDecodeError:
        log.warn("haiku_invalid_json")
    except Exception as e:
        log.error("haiku_error", error=str(e))

    return None
