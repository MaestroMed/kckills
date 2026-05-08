"""
DISCORD_AUTOPOST — Auto-share high-score published kills to a Discord webhook.

Phase 3 (community) per CLAUDE.md §12. Companion to migration 035 which
adds the kills.discord_posted_at column + the partial index this daemon
relies on.

Behaviour
─────────
Every 60 seconds the supervised daemon :

  1. SELECT kills WHERE status='published'
                  AND discord_posted_at IS NULL
                  AND highlight_score >= DISCORD_AUTOPOST_MIN_SCORE
     ORDER BY highlight_score DESC LIMIT 10
     (the index idx_kills_discord_unposted serves this directly)

  2. For each kill, build a gold-bordered embed (#C8AA6E per CLAUDE.md
     §2.1 design system). Title = "⚔️ {killer_champion} → {victim_champion}"
     with multi-kill prefix ("🔥 PENTAKILL — " etc.) when applicable.
     Description = ai_description, truncated to 300 chars (Discord embed
     description limit is 4096 but we keep it tight for mobile).

  3. POST to DISCORD_WEBHOOK_URL with content="" and embeds=[embed].

  4. On 200/204 → stamp discord_posted_at = now()
     On 429    → respect retry_after, log + skip rest of batch (try next cycle)
     On 5xx    → log error, leave discord_posted_at NULL → retried next cycle

The scheduler.wait_for("discord") (2.5s — see scheduler.py §3.9) gates
inter-call rate limiting so we never trip Discord's 30 req / 60s webhook
budget even if multiple workers share the same webhook URL.

Degraded mode
─────────────
If DISCORD_WEBHOOK_URL is missing/empty, the module logs once at startup
and no-ops every cycle (never crashes). This matches the same pattern as
push_notifier when VAPID keys are absent — kckills must keep running
even if a single env var is misconfigured.

Manual editorial pushes (/api/admin/editorial/discord) intentionally
do NOT touch discord_posted_at — they allow re-posting the same clip
(e.g. teaser then recap). Only this daemon stamps the column.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Any

import httpx
import structlog

from config import config
from scheduler import scheduler
from services.observability import note, run_logged
from services.supabase_client import get_db, safe_update

log = structlog.get_logger()


# ─── Tunables ─────────────────────────────────────────────────────────

# Per-cycle batch cap. Discord's webhook rate limit is 30 req / 60s per
# webhook URL ; with the scheduler enforcing 2.5s/call we'd theoretically
# fit 24/cycle but we leave headroom for the editorial push API and the
# watchdog alerts that share the same webhook (or rather a separate one,
# but the user's deployment may collapse them onto the same URL).
BATCH_LIMIT = 10

# Default minimum highlight_score to qualify for auto-post. The user's
# CLAUDE.md philosophy is "que du bon" — 8.0 is a high bar that filters
# to the top ~5% of clips per the analyzer's scoring distribution.
# Operator override : DISCORD_AUTOPOST_MIN_SCORE=7.5 in .env.
DEFAULT_MIN_SCORE = 8.0

# Truncation for the embed description — Discord caps at 4096 but mobile
# viewers see the first ~3 lines and the rest is collapsed. 300 chars is
# the sweet spot per the editorial design system.
MAX_DESCRIPTION_CHARS = 300

# Embed colour — gold (#C8AA6E) per CLAUDE.md §2.1 hextech palette.
# Discord wants an integer, NOT a hex string.
EMBED_COLOR_GOLD = 0xC8AA6E

# Multi-kill prefix table. French labels (fanbase audience).
MULTI_KILL_PREFIX = {
    "double": "💥 DOUBLE KILL — ",
    "triple": "💥 TRIPLE KILL — ",
    "quadra": "⚡ QUADRA KILL — ",
    "penta":  "🔥 PENTAKILL — ",
}


# Module-level latch so we only log "no webhook configured" once per
# daemon lifetime. A fresh log line every minute would be noise.
_no_webhook_logged = False


def _min_score() -> float:
    raw = os.getenv("DISCORD_AUTOPOST_MIN_SCORE", "")
    if not raw:
        return DEFAULT_MIN_SCORE
    try:
        return float(raw)
    except ValueError:
        log.warn(
            "discord_autopost_invalid_min_score",
            raw=raw[:20], fallback=DEFAULT_MIN_SCORE,
        )
        return DEFAULT_MIN_SCORE


# ─── Embed building ───────────────────────────────────────────────────

def _build_embed(kill: dict[str, Any]) -> dict[str, Any]:
    """Construct the Discord embed payload for one kill.

    Pure function — no I/O. Tested exhaustively in test_discord_autopost.
    """
    killer = kill.get("killer_champion") or "?"
    victim = kill.get("victim_champion") or "?"
    base_title = f"\u2694\ufe0f {killer} \u2192 {victim}"  # ⚔️ … →
    multi = kill.get("multi_kill")
    title = MULTI_KILL_PREFIX.get(multi, "") + base_title

    desc_raw = kill.get("ai_description") or "Nouveau clip Karmine Corp"
    desc = (desc_raw or "").strip()[:MAX_DESCRIPTION_CHARS]

    score = kill.get("highlight_score")
    score_str = f"{score:.1f}/10" if isinstance(score, (int, float)) else "—"

    fields: list[dict[str, Any]] = [
        {"name": "Score", "value": score_str, "inline": True},
    ]

    # Top 3 AI tags. ai_tags is a JSONB list — defensive parse.
    tags_raw = kill.get("ai_tags") or []
    if isinstance(tags_raw, list):
        top_tags = [str(t) for t in tags_raw[:3] if t]
        if top_tags:
            fields.append({
                "name": "Tags",
                "value": " · ".join(top_tags),
                "inline": True,
            })

    # First blood ribbon as a small contextual field.
    if kill.get("is_first_blood"):
        fields.append({
            "name": "Contexte",
            "value": "🩸 First Blood",
            "inline": True,
        })

    kill_id = kill["id"]
    fields.append({
        "name": "Match",
        "value": f"[Voir le clip](https://kckills.com/kill/{kill_id})",
        "inline": False,
    })

    embed: dict[str, Any] = {
        "title": title,
        "description": desc,
        "url": f"https://kckills.com/kill/{kill_id}",
        "color": EMBED_COLOR_GOLD,
        "fields": fields,
        "footer": {"text": "KCKILLS \u2022 highlight auto-pick"},
    }

    # Discord pulls the preview from the embed image. We prefer the
    # vertical clip URL (mobile-friendly aspect) but fall back to
    # thumbnail_url which is always populated by the clipper.
    image_url = kill.get("thumbnail_url")
    if image_url:
        embed["image"] = {"url": image_url}

    # Timestamp — prefer kill.created_at, default to now if missing/bad.
    ts_raw = kill.get("created_at")
    if isinstance(ts_raw, str) and ts_raw:
        embed["timestamp"] = ts_raw
    else:
        embed["timestamp"] = datetime.now(timezone.utc).isoformat()

    return embed


# ─── Webhook POST ─────────────────────────────────────────────────────

async def _post_embed(
    client: httpx.AsyncClient,
    webhook_url: str,
    embed: dict[str, Any],
) -> tuple[int, float | None]:
    """POST one embed to the webhook. Returns (status_code, retry_after_s).

    retry_after_s is non-None only on 429. Caller decides what to do
    with it — we don't sleep here so the caller can short-circuit the
    rest of the batch.
    """
    payload = {"content": "", "embeds": [embed]}
    r = await client.post(webhook_url, json=payload, timeout=10.0)
    retry_after = None
    if r.status_code == 429:
        # Discord returns retry_after either in a JSON body or in a
        # standard `Retry-After` header. Prefer the JSON value (more
        # precise, fractional seconds) but fall back to the header.
        try:
            body = r.json()
            ra = body.get("retry_after")
            if ra is not None:
                retry_after = float(ra)
        except Exception:
            pass
        if retry_after is None:
            ra_hdr = r.headers.get("Retry-After")
            if ra_hdr:
                try:
                    retry_after = float(ra_hdr)
                except ValueError:
                    pass
        if retry_after is None:
            retry_after = 5.0  # safe default
    return r.status_code, retry_after


def _stamp_posted(kill_id: str) -> bool:
    """Mark a kill as posted — sets discord_posted_at = now()."""
    return bool(safe_update(
        "kills",
        {"discord_posted_at": datetime.now(timezone.utc).isoformat()},
        "id", kill_id,
    ))


# ─── DB query — uses raw httpx for the gte filter + ORDER BY + LIMIT ──

def _fetch_eligible(db, min_score: float) -> list[dict]:
    """Get up to BATCH_LIMIT kills eligible for auto-post.

    PostgREST equivalent of :
        SELECT id, killer_champion, victim_champion, ai_description,
               highlight_score, ai_tags, multi_kill, is_first_blood,
               thumbnail_url, clip_url_vertical, created_at
        FROM kills
        WHERE status = 'published'
          AND discord_posted_at IS NULL
          AND highlight_score >= :min_score
        ORDER BY highlight_score DESC NULLS LAST
        LIMIT :BATCH_LIMIT
    """
    try:
        r = httpx.get(
            f"{db.base}/kills",
            headers=db.headers,
            params={
                "select": (
                    "id,killer_champion,victim_champion,ai_description,"
                    "highlight_score,ai_tags,multi_kill,is_first_blood,"
                    "thumbnail_url,clip_url_vertical,created_at"
                ),
                "status": "eq.published",
                "discord_posted_at": "is.null",
                "highlight_score": f"gte.{min_score}",
                "order": "highlight_score.desc.nullslast",
                "limit": str(BATCH_LIMIT),
            },
            timeout=15.0,
        )
        if r.status_code != 200:
            log.warn(
                "discord_autopost_query_failed",
                status=r.status_code, body=r.text[:200],
            )
            return []
        return r.json() or []
    except Exception as e:
        log.warn("discord_autopost_query_threw", error=str(e)[:160])
        return []


# ─── Daemon entry point ───────────────────────────────────────────────

@run_logged()
async def run() -> int:
    """Scan + post one batch of high-score kills. Returns count posted."""
    global _no_webhook_logged

    webhook_url = (config.DISCORD_WEBHOOK_URL or "").strip()
    if not webhook_url:
        if not _no_webhook_logged:
            log.info("discord_autopost_skip_no_webhook")
            _no_webhook_logged = True
        return 0
    # Reset latch in case the operator added the env var mid-run and
    # restarted the daemon — first successful cycle re-arms the warning.
    _no_webhook_logged = False

    db = get_db()
    if db is None:
        log.warn("discord_autopost_no_db")
        return 0

    min_score = _min_score()
    eligible = await asyncio.to_thread(_fetch_eligible, db, min_score)
    note(items_scanned=len(eligible))
    if not eligible:
        return 0

    log.info(
        "discord_autopost_batch_start",
        count=len(eligible),
        min_score=min_score,
        top_score=eligible[0].get("highlight_score"),
    )

    posted = 0
    failed = 0
    rate_limited = False

    # Wave 27.11 — pooled client survives across daemon cycles, so the
    # next autopost run lands on a warm socket. The per-batch context
    # manager closed the connection every time the run() returned.
    from services import http_pool
    client = http_pool.get("discord_webhook", timeout=10)
    for kill in eligible:
        if rate_limited:
            # 429 hit earlier in the batch — bail until next cycle.
            break

        # Scheduler enforces the 2.5s inter-call delay (see CLAUDE.md
        # §3.9). Returns False if a daily quota would block — there's
        # no daily quota for "discord" so this stays True.
        await scheduler.wait_for("discord")

        embed = _build_embed(kill)
        try:
            status, retry_after = await _post_embed(client, webhook_url, embed)
        except Exception as e:
            log.warn(
                "discord_autopost_post_threw",
                kill_id=kill["id"][:8], error=str(e)[:160],
            )
            failed += 1
            continue

        if status in (200, 204):
            ok = await asyncio.to_thread(_stamp_posted, kill["id"])
            if ok:
                posted += 1
                log.info(
                    "discord_autopost_posted",
                    kill_id=kill["id"][:8],
                    score=kill.get("highlight_score"),
                    multi=kill.get("multi_kill"),
                )
            else:
                # Webhook delivered but DB update failed — leave the
                # row unstamped so we retry next cycle. Discord may
                # see a duplicate but that's better than losing the
                # post permanently.
                failed += 1
                log.warn(
                    "discord_autopost_stamp_failed",
                    kill_id=kill["id"][:8],
                )
        elif status == 429:
            rate_limited = True
            log.warn(
                "discord_autopost_rate_limited",
                kill_id=kill["id"][:8],
                retry_after=retry_after,
            )
            # Don't update the DB — the row stays unposted and will
            # surface again next cycle (60s later, well past any
            # reasonable Discord retry_after).
        elif 500 <= status < 600:
            failed += 1
            log.warn(
                "discord_autopost_5xx",
                kill_id=kill["id"][:8], status=status,
            )
            # No DB update → retried next cycle. Don't bail the batch
            # because 5xx can be transient and the next clip may
            # land on a healthy Discord shard.
        else:
            # 4xx other than 429 — likely a malformed embed or a bad
            # webhook URL. Log loudly but leave the row unstamped so
            # the operator notices the backlog growing.
            failed += 1
            log.error(
                "discord_autopost_4xx",
                kill_id=kill["id"][:8], status=status,
            )

    note(items_processed=posted, items_failed=failed)
    log.info(
        "discord_autopost_batch_done",
        posted=posted,
        failed=failed,
        rate_limited=rate_limited,
    )
    return posted
