"""
MODERATOR — Claude Haiku 4.5 moderates comments before publication.

Each comment is classified as: approve, flag, or reject.
Trash talk between fans is OK. Toxicity, hate, harassment = reject.
"""

import json
import structlog
from scheduler import scheduler
from config import config

log = structlog.get_logger()

MODERATION_PROMPT = """Modere ce commentaire sur un site de clips esport LoL.
Commentaire de "{username}": "{content}"
Reponds UNIQUEMENT en JSON: {{"action":"approve|flag|reject","reason":"...","toxicity":0.0-10.0}}
Regles: le trash talk leger entre fans est OK, les emojis et l'argot gaming sont OK.
reject = toxique, spam, haine, harcelement, contenu illegal.
flag = douteux, necessite review humain."""


async def moderate_comment(username: str, content: str) -> dict:
    """Moderate a comment. Returns {action, reason, toxicity}."""
    if not config.ANTHROPIC_API_KEY:
        # No API key → auto-approve (degraded mode)
        return {"action": "approve", "reason": "no_moderation_key", "toxicity": 0}

    can_call = await scheduler.wait_for("haiku")
    if not can_call:
        return {"action": "approve", "reason": "rate_limited", "toxicity": 0}

    prompt = MODERATION_PROMPT.format(username=username, content=content)

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        text = message.content[0].text.strip()
        result = json.loads(text)
        log.info("comment_moderated", action=result.get("action"), toxicity=result.get("toxicity"))
        return result

    except ImportError:
        log.warn("anthropic_sdk_not_installed")
        return {"action": "approve", "reason": "sdk_missing", "toxicity": 0}
    except json.JSONDecodeError:
        log.warn("haiku_invalid_json")
        return {"action": "flag", "reason": "parse_error", "toxicity": 5}
    except Exception as e:
        log.error("haiku_error", error=str(e))
        return {"action": "approve", "reason": f"error: {e}", "toxicity": 0}


# ─── Daemon loop ─────────────────────────────────────────────────────────

async def run() -> int:
    """Process all comments in moderation_status='pending'.

    Reads username from profile if available, else uses the user_id
    fragment as fallback identifier.
    """
    from services.supabase_client import safe_select, safe_update

    log.info("moderator_scan_start")

    pending = safe_select(
        "comments",
        "id, content, user_id, kill_id",
        moderation_status="pending",
    ) or []
    if not pending:
        return 0

    # Optional: fetch profiles for usernames
    profiles_raw = safe_select("profiles", "id,discord_username") or []
    profile_lookup = {p["id"]: p.get("discord_username") for p in profiles_raw}

    moderated = 0
    for comment in pending:
        username = profile_lookup.get(comment.get("user_id"), "user")
        result = await moderate_comment(username, comment.get("content") or "")

        new_status_map = {
            "approve": "approved",
            "flag": "flagged",
            "reject": "rejected",
        }
        new_status = new_status_map.get(result.get("action"), "flagged")

        toxicity = result.get("toxicity")
        try:
            toxicity_val = float(toxicity) if toxicity is not None else None
        except (TypeError, ValueError):
            toxicity_val = None

        patch = {
            "moderation_status": new_status,
            "moderation_reason": result.get("reason"),
        }
        if toxicity_val is not None:
            patch["toxicity_score"] = toxicity_val

        safe_update("comments", patch, "id", comment["id"])
        moderated += 1

    log.info("moderator_scan_done", moderated=moderated)
    return moderated
