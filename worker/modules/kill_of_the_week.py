"""
KILL_OF_THE_WEEK — Sunday-night auto-pick of the highest-scoring KC kill
of the past 7 days.

Cron-style daemon module : the orchestrator runs us once per hour. We
only do real work in the Sunday 22:00–22:59 UTC window. Outside that
slot the function is a no-op.

When the window fires :
  1. Query the last 7 days of KC killer kills with kill_visible=true
     and highlight_score >= 7.0, sorted desc by highlight_score.
  2. Idempotency check : if a featured_clips row already exists for the
     upcoming Mon 00:00 UTC window, skip.
  3. Pick the top kill, upsert featured_clips with set_by='kill_of_the_week'
     and a window of next Mon 00:00 UTC -> Tue 23:59:59 UTC.
  4. Log to editorial_actions.
  5. Post a gold-accent embed to the Discord webhook.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import structlog

from config import config
from services.observability import run_logged
from services.supabase_client import get_db, safe_insert, safe_upsert

log = structlog.get_logger()


LOOKBACK_DAYS = 7
MIN_HIGHLIGHT_SCORE = 7.0
WINDOW_HOUR_UTC = 22
WINDOW_DAY_UTC = 6  # Sunday


def _next_monday_window(now: datetime) -> tuple[datetime, datetime]:
    days_until_monday = (0 - now.weekday()) % 7
    if days_until_monday == 0:
        days_until_monday = 7
    next_monday = (now + timedelta(days=days_until_monday)).replace(
        hour=0, minute=0, second=0, microsecond=0,
    )
    next_tuesday_end = next_monday + timedelta(days=1, hours=23, minutes=59, seconds=59)
    return next_monday, next_tuesday_end


def _is_in_window(now: datetime) -> bool:
    return now.weekday() == WINDOW_DAY_UTC and now.hour == WINDOW_HOUR_UTC


async def _pick_top_kill(db) -> Optional[dict]:
    """Wave 27.10 — async + asyncio.to_thread offload so the once-per-
    hour KOTW pick doesn't freeze the event loop on the PostgREST
    round-trip."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    params = {
        "select": (
            "id,killer_champion,victim_champion,thumbnail_url,"
            "highlight_score,ai_description,multi_kill,is_first_blood,"
            "created_at"
        ),
        "status": "eq.published",
        "kill_visible": "eq.true",
        "tracked_team_involvement": "eq.team_killer",
        "highlight_score": f"gte.{MIN_HIGHLIGHT_SCORE}",
        "created_at": f"gte.{cutoff}",
        "order": "highlight_score.desc.nullslast",
        "limit": "1",
    }
    try:
        r = await asyncio.to_thread(
            httpx.get,
            f"{db.base}/kills",
            headers=db.headers,
            params=params,
            timeout=15,
        )
        r.raise_for_status()
        rows = r.json() or []
        return rows[0] if rows else None
    except Exception as e:
        log.warn("kotw_query_failed", error=str(e))
        return None


async def _already_pinned_for(db, valid_from_iso: str) -> bool:
    """Wave 27.10 — async + asyncio.to_thread."""
    params = {
        "select": "kill_id,valid_from,set_by",
        "valid_from": f"eq.{valid_from_iso}",
        "set_by": "eq.kill_of_the_week",
        "limit": "1",
    }
    try:
        r = await asyncio.to_thread(
            httpx.get,
            f"{db.base}/featured_clips",
            headers=db.headers,
            params=params,
            timeout=15,
        )
        r.raise_for_status()
        return bool(r.json())
    except Exception as e:
        log.warn("kotw_idempotency_check_failed", error=str(e))
        return False


async def _post_discord(kill: dict, valid_from: datetime, valid_to: datetime) -> None:
    webhook = getattr(config, "DISCORD_WEBHOOK_URL", None) or __import__("os").getenv("DISCORD_WEBHOOK_URL")
    if not webhook:
        log.info("kotw_discord_skip_no_webhook")
        return

    score = kill.get("highlight_score")
    score_str = f"{score:.1f}" if isinstance(score, (int, float)) else "?"
    desc = (kill.get("ai_description") or "Kill de la semaine KC").strip()

    embed = {
        "title": f"★ Kill of the Week : {kill.get('killer_champion')} → {kill.get('victim_champion')}",
        "description": desc[:300],
        "url": f"https://kckills.com/scroll?kill={kill['id']}",
        "color": 0xFFD700,
        "fields": [
            {"name": "Score", "value": f"{score_str}/10", "inline": True},
            {
                "name": "À l'affiche",
                "value": (
                    valid_from.strftime("%a %d %b") + " → " + valid_to.strftime("%a %d %b UTC")
                ),
                "inline": True,
            },
        ],
        "footer": {"text": "KCKILLS · kill of the week (auto)"},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if kill.get("thumbnail_url"):
        embed["thumbnail"] = {"url": kill["thumbnail_url"]}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                webhook,
                json={"content": "@everyone Le **Kill of the Week** est tombé 🔥",
                      "embeds": [embed]},
            )
        log.info("kotw_discord_pushed", kill_id=kill["id"])
    except Exception as e:
        log.warn("kotw_discord_post_failed", error=str(e))


@run_logged()
async def run() -> None:
    now = datetime.now(timezone.utc)
    if not _is_in_window(now):
        return

    db = get_db()
    if db is None:
        log.warn("kotw_no_db")
        return

    valid_from, valid_to = _next_monday_window(now)
    valid_from_iso = valid_from.isoformat()
    valid_to_iso = valid_to.isoformat()

    if await _already_pinned_for(db, valid_from_iso):
        log.info("kotw_already_pinned", window=valid_from_iso)
        return

    kill = await _pick_top_kill(db)
    if not kill:
        log.warn(
            "kotw_no_qualifying_kill",
            min_score=MIN_HIGHLIGHT_SCORE,
            lookback_days=LOOKBACK_DAYS,
        )
        return

    feature_date = valid_from.date().isoformat()

    safe_upsert(
        "featured_clips",
        {
            "feature_date": feature_date,
            "kill_id": kill["id"],
            "valid_from": valid_from_iso,
            "valid_to": valid_to_iso,
            "custom_note": "Kill of the Week (auto-pick)",
            "set_by": "kill_of_the_week",
            "set_by_actor": "kill_of_the_week",
            "set_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="feature_date",
    )

    safe_insert(
        "editorial_actions",
        {
            "action": "kotw.auto_pick",
            "kill_id": kill["id"],
            "performed_by": "kill_of_the_week",
            "payload": {
                "valid_from": valid_from_iso,
                "valid_to": valid_to_iso,
                "feature_date": feature_date,
                "highlight_score": kill.get("highlight_score"),
                "killer_champion": kill.get("killer_champion"),
                "victim_champion": kill.get("victim_champion"),
            },
        },
    )

    log.info(
        "kotw_pinned",
        kill_id=kill["id"],
        score=kill.get("highlight_score"),
        valid_from=valid_from_iso,
        valid_to=valid_to_iso,
    )

    await _post_discord(kill, valid_from, valid_to)
