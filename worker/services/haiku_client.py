"""Claude Haiku 4.5 client — generic moderation helper.

NOTE (Wave 13e+) : the active moderation path is `worker.modules.moderator
.moderate_comment` — that's where prompt caching is applied (system block
with `cache_control={"type":"ephemeral"}`, 5-min TTL, ~90% read discount).

This module is a legacy generic wrapper kept for ad-hoc scripts. If you
add a new caller, prefer the modules.moderator path so you inherit the
cache. If you must call this helper, pass the system prompt separately
via the `system_prompt` arg below — that block is cached.
"""

import json
import structlog
from config import config
from scheduler import scheduler

log = structlog.get_logger()


async def moderate(
    prompt: str,
    system_prompt: str | None = None,
) -> dict | None:
    """Send moderation prompt to Haiku. Returns parsed JSON or None.

    Args :
      prompt        — dynamic user message (NOT cached).
      system_prompt — optional static system block (CACHED via
                      Anthropic prompt caching, 5-min TTL).
    """
    if not config.ANTHROPIC_API_KEY:
        return None

    can_call = await scheduler.wait_for("haiku")
    if not can_call:
        return None

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
        # Build kwargs : only send `system=[...]` if a system_prompt is
        # provided. Anthropic charges $1.25/M for cache writes (1.25× of
        # the $1.00/M input price) so caching a tiny prompt is a net loss
        # — we only flag cache_control if the caller opted in by passing
        # a system_prompt, which they should only do for static blocks.
        kwargs = {
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 200,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system_prompt:
            kwargs["system"] = [
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ]
        message = client.messages.create(**kwargs)
        text = message.content[0].text.strip()
        return json.loads(text)

    except ImportError:
        log.warn("anthropic_sdk_missing")
    except json.JSONDecodeError:
        log.warn("haiku_invalid_json")
    except Exception as e:
        log.error("haiku_error", error=str(e))

    return None
