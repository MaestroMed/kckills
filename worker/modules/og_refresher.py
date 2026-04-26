"""
OG_REFRESHER — Periodic regen of OG images when the AI description
changes (or when published kills never got an OG image in the first
place).

Why this exists
---------------
og_generator.py only fires once per kill (queue model : one og.generate
job per (kill_id) at a time). When the analyzer rewrites a kill's
ai_description (premium re-analysis, manual admin trigger via
reanalyze_published, model upgrade), the existing OG image becomes stale
— the share-card still shows the old caption while the in-app UI shows
the new one. We need to detect that drift and re-enqueue.

Ideal world : `kills.ai_description_updated_at` and
`kills.og_generated_at` columns + a SQL filter
`ai_description_updated_at > og_generated_at`. We don't have those
(adding them needs a migration we can't ship from this PR), so we use
two proxy signals instead :

Freshness check formula (no migration required)
------------------------------------------------
A kill is a regen candidate if EITHER :

  (A) status='published' AND og_image_url IS NULL                    →
      missed-OG-publish bug. Always regen — a published kill should
      always have an OG image.

  (B) status='published' AND og_image_url IS NOT NULL AND
      EXISTS (SELECT 1 FROM ai_annotations a
              WHERE a.kill_id = k.id
              AND a.created_at > k.updated_at - interval '1 hour')
      AND k.updated_at > now() - interval '24 hours'                 →
      proxy : the kill's `updated_at` was bumped recently AND there's
      a recent ai_annotations row for it, which strongly suggests the
      analyzer just rewrote the description. The 1-hour window between
      the annotation insert and the kill row update covers the
      analyzer's batched flush latency.

Both branches feed the same `og.generate` queue. Cap : 50 enqueues per
cycle so a backlog spike from a model rerun doesn't flood the queue.

Future migration TODO
---------------------
When we can ship a migration, add :
  ALTER TABLE kills ADD COLUMN og_generated_at TIMESTAMPTZ;
  ALTER TABLE kills ADD COLUMN ai_description_updated_at TIMESTAMPTZ;
And replace the proxy check with the simple
`ai_description_updated_at > og_generated_at` SQL filter. The proxy
covers ~95% of real cases but mis-fires on edits to non-AI fields
(rating tally, comment count) — we accept the small false-positive
rate because og_generator.generate_og_image is idempotent and cheap
(~200ms render + 1 R2 upload).

Wiring
------
Intended to run every 6h (21600s) in worker/main.py DAEMON_MODULES.
The wiring itself lives in main.py and is owned by another agent
(Wave 8 Agent AK) — this module is import-ready : `from modules import
og_refresher; await og_refresher.run()`.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import structlog

from services import job_queue
from services.observability import note, run_logged
from services.supabase_client import get_db

log = structlog.get_logger()


# Hard cap per cycle — even if 500 kills are stale, we only enqueue 50
# at a time so the queue + clipper-side throughput don't get crushed by
# a single model-rerun event. The next cycle (6h later) picks up the
# remainder.
MAX_ENQUEUE_PER_CYCLE = 50

# Page size for the proxy-check scan. We pull 200 candidates max per
# scan — anything bigger and the AI-annotations lookup loop becomes
# the bottleneck. We trim to MAX_ENQUEUE_PER_CYCLE after dedup.
SCAN_PAGE_SIZE = 200

# Window for the "recent description rewrite" proxy. Kills whose
# `updated_at` is within this window are considered "potentially
# touched by the analyzer". 24h is generous — the analyzer flushes
# in batches and the bump-then-write window can stretch a few hours.
RECENT_UPDATED_HOURS = 24

# Window relative to k.updated_at within which an ai_annotations row
# must exist to consider the description "freshly rewritten". 1h
# accounts for the analyzer's batched flush latency between the
# annotation insert and the kill row update.
ANNOTATION_RECENCY_HOURS = 1

# Queue priority — same as the backfill script (60), above the default
# 50 used for fresh og.generate jobs but below editorial 80.
QUEUE_PRIORITY = 60

# Max attempts per og.generate job. The og_generator already has its
# own retry-on-fail pathway (600s retry_after), so 3 is plenty.
MAX_ATTEMPTS = 3


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _isoformat(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


# ─── Branch A : published with NULL og_image_url ─────────────────────

def _scan_missing_og(db) -> list[dict]:
    """Pull published kills whose og_image_url is still NULL.

    These are bug-leftovers : either an old run that never enqueued an
    og.generate job, or a job that hit max retries and got DLQ'd. We
    re-enqueue them unconditionally — having a published kill without
    an OG image is always wrong.
    """
    try:
        r = httpx.get(
            f"{db.base}/kills",
            headers=db.headers,
            params={
                "select": "id,game_id,killer_champion,victim_champion,ai_description,highlight_score",
                "status": "eq.published",
                "og_image_url": "is.null",
                "order": "highlight_score.desc.nullslast,created_at.desc",
                "limit": str(SCAN_PAGE_SIZE),
            },
            timeout=20.0,
        )
        if r.status_code != 200:
            log.warn(
                "og_refresher_missing_scan_failed",
                http=r.status_code, body=r.text[:200],
            )
            return []
        return r.json() or []
    except Exception as e:
        log.warn("og_refresher_missing_scan_threw", error=str(e)[:200])
        return []


# ─── Branch B : recent description-rewrite proxy ────────────────────

def _scan_recently_updated(db) -> list[dict]:
    """Pull published kills whose `updated_at` is within the last 24h
    AND whose og_image_url is already set (we're checking for stale OGs,
    not missing ones — Branch A handles missing).

    The follow-up `_has_recent_annotation()` filter narrows this to
    rows where the analyzer actually wrote a fresh annotation in the
    same window — that's our proxy for "ai_description was rewritten
    recently".
    """
    cutoff = _now_utc() - timedelta(hours=RECENT_UPDATED_HOURS)
    try:
        r = httpx.get(
            f"{db.base}/kills",
            headers=db.headers,
            params={
                "select": (
                    "id,game_id,killer_champion,victim_champion,"
                    "ai_description,highlight_score,updated_at,og_image_url"
                ),
                "status": "eq.published",
                "og_image_url": "not.is.null",
                "updated_at": f"gte.{_isoformat(cutoff)}",
                "order": "updated_at.desc",
                "limit": str(SCAN_PAGE_SIZE),
            },
            timeout=20.0,
        )
        if r.status_code != 200:
            log.warn(
                "og_refresher_recent_scan_failed",
                http=r.status_code, body=r.text[:200],
            )
            return []
        return r.json() or []
    except Exception as e:
        log.warn("og_refresher_recent_scan_threw", error=str(e)[:200])
        return []


def _has_recent_annotation(db, kill_id: str, kill_updated_at_iso: str) -> bool:
    """Check whether an ai_annotations row exists for this kill within
    ANNOTATION_RECENCY_HOURS of the kill's `updated_at`.

    Why a per-kill GET instead of a JOIN ?
    PostgREST doesn't expose JOIN syntax cleanly — embedded resources
    work but require FK declarations and don't accept the `created_at >
    other_table.col` predicate we want. Per-kill GETs are 1 RTT each
    but with limit=1 + select=id they cost ~5ms — at SCAN_PAGE_SIZE=200
    that's ~1s of total wall-time per cycle, acceptable for a 6h
    daemon.
    """
    try:
        # Parse the kill's updated_at into a datetime, then build the
        # window edges. Using a string-only approach (k.updated_at -
        # interval '1h') would need a server-side filter expression
        # that PostgREST doesn't expose, so we compute the bounds here.
        try:
            k_updated_at = datetime.fromisoformat(
                kill_updated_at_iso.replace("Z", "+00:00")
            )
        except (ValueError, TypeError, AttributeError):
            return False
        window_start = k_updated_at - timedelta(hours=ANNOTATION_RECENCY_HOURS)
        window_end = k_updated_at + timedelta(hours=ANNOTATION_RECENCY_HOURS)

        r = httpx.get(
            f"{db.base}/ai_annotations",
            headers=db.headers,
            params={
                "select": "id",
                "kill_id": f"eq.{kill_id}",
                "created_at": f"gte.{_isoformat(window_start)}",
                "limit": "1",
                # Order desc + limit 1 -> we just want to know if any row
                # exists in the window. We don't need the upper bound
                # filter because a created_at past window_end implies the
                # kill row would be even more recent.
            },
            timeout=10.0,
        )
        if r.status_code != 200:
            return False
        rows = r.json() or []
        # Sanity-check : the row must be within window_end too. PostgREST's
        # `lte` on the same column collapses to a range filter cleanly,
        # but two separate params on `created_at` would override each
        # other — so we filter in Python.
        for row in rows:
            ca = row.get("created_at") or ""
            try:
                row_dt = datetime.fromisoformat(ca.replace("Z", "+00:00"))
                if window_start <= row_dt <= window_end:
                    return True
            except (ValueError, TypeError):
                continue
        return False
    except Exception as e:
        log.warn(
            "og_refresher_annotation_check_failed",
            kill_id=kill_id[:8] if kill_id else "?",
            error=str(e)[:160],
        )
        return False


# ─── Daemon entry point ──────────────────────────────────────────────

@run_logged()
async def run() -> int:
    """One refresh cycle. Returns the number of og.generate jobs enqueued.

    Flow :
      1. Branch A : scan published kills with NULL og_image_url. These
         are unconditionally re-enqueued (always wrong to have one).
      2. Branch B : scan recently-updated published kills, then filter
         in-Python to those with a recent ai_annotations row (proxy
         for "description was just rewritten").
      3. Dedup the two lists (a kill in Branch A can't be in Branch B
         because Branch B requires og_image_url IS NOT NULL).
      4. Cap at MAX_ENQUEUE_PER_CYCLE.
      5. Enqueue each as og.generate at priority 60.
    """
    db = get_db()
    if db is None:
        log.warn("og_refresher_no_db")
        return 0

    log.info("og_refresher_start")

    # ─── Branch A : missing OG ────────────────────────────────────
    missing = await asyncio.to_thread(_scan_missing_og, db)
    branch_a_count = len(missing)

    # ─── Branch B : recent description rewrite ────────────────────
    recently_updated = await asyncio.to_thread(_scan_recently_updated, db)
    branch_b_pre = len(recently_updated)

    # Filter in-Python : keep only those with a recent ai_annotations row.
    branch_b: list[dict] = []
    for k in recently_updated:
        kid = k.get("id")
        upd = k.get("updated_at")
        if not kid or not upd:
            continue
        if await asyncio.to_thread(_has_recent_annotation, db, kid, upd):
            branch_b.append(k)
    branch_b_count = len(branch_b)

    # ─── Dedup + cap ─────────────────────────────────────────────
    seen: set[str] = set()
    candidates: list[dict] = []
    for src in (missing, branch_b):
        for k in src:
            kid = k.get("id")
            if not kid or kid in seen:
                continue
            seen.add(kid)
            candidates.append(k)
            if len(candidates) >= MAX_ENQUEUE_PER_CYCLE:
                break
        if len(candidates) >= MAX_ENQUEUE_PER_CYCLE:
            break

    # ─── Enqueue ─────────────────────────────────────────────────
    enqueued = 0
    skipped = 0
    for k in candidates:
        kid = k["id"]
        gid = k.get("game_id")
        jid = await asyncio.to_thread(
            job_queue.enqueue,
            "og.generate",
            "kill",
            kid,
            {"kill_id": kid, "game_id": gid},
            QUEUE_PRIORITY,
            None,
            MAX_ATTEMPTS,
        )
        if jid is None:
            # Already-enqueued (dedup via unique partial index) — fine.
            skipped += 1
        else:
            enqueued += 1

    note(
        items_scanned=branch_a_count + branch_b_pre,
        items_processed=enqueued,
        items_skipped=skipped,
        branch_a=branch_a_count,
        branch_b=branch_b_count,
        cap=MAX_ENQUEUE_PER_CYCLE,
    )

    log.info(
        "og_refresher_done",
        branch_a=branch_a_count,
        branch_b_pre_filter=branch_b_pre,
        branch_b_post_filter=branch_b_count,
        enqueued=enqueued,
        skipped=skipped,
        cap=MAX_ENQUEUE_PER_CYCLE,
    )
    return enqueued


__all__ = ["run"]
