"""
QC_SAMPLER — Risk-based QC selection for published clips.

Why : the clip_qc verifier (admin-triggered) catches timer drift > 30s
on individual clips, but admin only QCs clips that look suspicious. The
v1 sampler did random 2% sampling — fine for a baseline signal but it
spent Gemini quota on clips that were almost certainly correct (well-
known VOD source, livestats anchor, mid-range highlight score).

PR23-arch flips this : we score every published candidate by a set of
heuristic risk bumps and sample anything above 0.5 (capped per cycle).
Random 2% baseline is preserved so we still get unbiased coverage of
the "looks-fine" population.

Risk bumps :
  +0.5  asset.source_offset_seconds was found by vof2 (vs livestats anchor)
  +0.3  data_source = 'gol_gg' (less reliable than livestats)
  +0.4  first kill from this VOD (no prior verified clip from same vod)
  +0.3  highlight_score is extreme (>= 9 or <= 3)
  +0.5  ai_annotation.confidence_score < 0.5
  +0.6  recent ffmpeg warning logged for this kill
  +1.0  user reported the clip (>= 1 pending report in `reports` table)
  +0.5  ADDITIONAL bump when >= 3 pending reports (very confident bad)
  +0.4  duration outside [15s, 30s]

Pipeline :
  1. fetch up to SAMPLE_POOL_SIZE recently-published kills
  2. bulk-fetch matching kill_assets (current horizontal/vertical) and
     current ai_annotations rows
  3. compute risk_score per candidate
  4. dedup against recent clip_qc.verify jobs (DEDUP_WINDOW_DAYS)
  5. enqueue top-N by risk score (cap = SAMPLE_PICK_SIZE)

Quota math :
  - up to 50 jobs/cycle × 1 cycle/h = 1200 QC checks/day in the worst
    case. The v1 spec assumed ~480/day — we go higher because risk-
    selected clips are exactly the ones most likely to need a re-clip.
  - Gemini cap = 950 RPD. The job_runner naturally throttles via the
    shared scheduler, so excess jobs queue up and drain over time.
"""

from __future__ import annotations

import json
import random
from datetime import datetime, timezone, timedelta

import httpx
import structlog

from services import job_queue, team_config  # noqa: F401 — imported so QC stays team-aware
from services.observability import run_logged
from services.supabase_client import get_db, safe_insert

log = structlog.get_logger()


# ─── Tunables ────────────────────────────────────────────────────────────
SAMPLE_POOL_SIZE = 500          # how many recent clips we look at
SAMPLE_PICK_SIZE = 50           # PR23 — bumped from 20 to 50 (risk-driven)
RECENT_WINDOW_DAYS = 30         # only QC clips published in last 30d
DEDUP_WINDOW_DAYS = 60          # don't re-QC same kill within 60d

RISK_THRESHOLD = 0.5            # any kill at or above this is sampled
RANDOM_BASELINE_RATE = 0.02     # 2% baseline = unbiased coverage of
                                # the looks-fine population

# Risk bumps — kept as constants for testability + tuning.
RISK_VOF2_OFFSET     = 0.5      # offset found by vof2 vs livestats anchor
RISK_GOLGG_SOURCE    = 0.3      # data_source = 'gol_gg'
RISK_FIRST_FROM_VOD  = 0.4      # no prior verified clip from same vod
RISK_EXTREME_SCORE   = 0.3      # highlight_score >= 9 or <= 3
RISK_LOW_CONFIDENCE  = 0.5      # ai_annotation.confidence_score < 0.5
RISK_FFMPEG_WARNING  = 0.6      # recent ffmpeg warning for this kill
RISK_USER_REPORTED       = 1.0  # ≥1 pending user report
RISK_USER_REPORTED_HEAVY = 0.5  # extra +0.5 when ≥3 pending reports — very confident bad
RISK_HEAVY_REPORT_THRESHOLD = 3
RISK_WEIRD_DURATION  = 0.4      # duration outside [15s, 30s]


# ─── Pool fetch ─────────────────────────────────────────────────────────

async def _fetch_recent_published(db) -> list[dict]:
    """Get latest published clips with the fields we need to score risk."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RECENT_WINDOW_DAYS)).isoformat()
    r = httpx.get(
        f"{db.base}/kills",
        headers=db.headers,
        params={
            "select": (
                "id,created_at,clip_url_horizontal,vod_youtube_id,"
                "highlight_score,data_source,kill_visible,duration_ms"
            ),
            "status": "eq.published",
            "kill_visible": "eq.true",
            "clip_url_horizontal": "not.is.null",
            "created_at": f"gte.{cutoff}",
            "order": "created_at.desc",
            "limit": SAMPLE_POOL_SIZE,
        },
        timeout=15.0,
    )
    if r.status_code != 200:
        log.warn("qc_sampler_fetch_failed", status=r.status_code, body=r.text[:200])
        return []
    return r.json() or []


async def _fetch_already_qcd(db, kill_ids: list[str]) -> set[str]:
    """Find which of these kill_ids already have a recent qc.verify job.

    PR23-arch : checks BOTH the new pipeline_jobs (entity_type='kill',
    type='qc.verify') and the legacy worker_jobs (kind='clip_qc.verify')
    so we don't double-QC during the migration window.
    """
    if not kill_ids:
        return set()
    cutoff_iso = (
        datetime.now(timezone.utc) - timedelta(days=DEDUP_WINDOW_DAYS)
    ).isoformat()
    seen: set[str] = set()

    # Modern path : pipeline_jobs
    try:
        r = httpx.get(
            f"{db.base}/pipeline_jobs",
            headers=db.headers,
            params={
                "select": "entity_id",
                "type": "eq.qc.verify",
                "entity_type": "eq.kill",
                "created_at": f"gte.{cutoff_iso}",
                "limit": 2000,
            },
            timeout=15.0,
        )
        if r.status_code == 200:
            for row in r.json() or []:
                eid = row.get("entity_id")
                if eid:
                    seen.add(eid)
        else:
            log.debug("qc_sampler_dedup_pipeline_jobs_skipped", status=r.status_code)
    except Exception as e:
        log.debug("qc_sampler_dedup_pipeline_jobs_error", error=str(e)[:120])

    # Legacy path : worker_jobs (kept for the migration window)
    try:
        r = httpx.get(
            f"{db.base}/worker_jobs",
            headers=db.headers,
            params={
                "select": "payload",
                "kind": "eq.clip_qc.verify",
                "requested_at": f"gte.{cutoff_iso}",
                "limit": 2000,
            },
            timeout=15.0,
        )
        if r.status_code == 200:
            for row in r.json() or []:
                pl = row.get("payload") or {}
                kid = pl.get("kill_id") if isinstance(pl, dict) else None
                if kid:
                    seen.add(kid)
        else:
            log.debug("qc_sampler_dedup_worker_jobs_skipped", status=r.status_code)
    except Exception as e:
        log.debug("qc_sampler_dedup_worker_jobs_error", error=str(e)[:120])

    return seen


def _fetch_assets_bulk(db, kill_ids: list[str]) -> dict[str, dict]:
    """Bulk-fetch the current 'horizontal' (or 'vertical' fallback) asset
    for each kill_id. Returns {kill_id: asset_row}.
    """
    if not kill_ids:
        return {}
    out: dict[str, dict] = {}
    # PostgREST `in.(...)` filter
    in_filter = "in.(" + ",".join(kill_ids) + ")"
    try:
        r = httpx.get(
            f"{db.base}/kill_assets",
            headers=db.headers,
            params={
                "select": "kill_id,type,version,duration_ms,source_offset_seconds",
                "kill_id": in_filter,
                "is_current": "eq.true",
                "limit": 5000,
            },
            timeout=20.0,
        )
        if r.status_code != 200:
            log.debug("qc_sampler_assets_fetch_skipped",
                      status=r.status_code, body=r.text[:120])
            return {}
        rows = r.json() or []
        # Prefer horizontal, fall back to vertical
        for row in rows:
            kid = row.get("kill_id")
            if not kid:
                continue
            existing = out.get(kid)
            if existing is None:
                out[kid] = row
            elif existing.get("type") != "horizontal" and row.get("type") == "horizontal":
                out[kid] = row
    except Exception as e:
        log.debug("qc_sampler_assets_fetch_error", error=str(e)[:120])
    return out


def _fetch_annotations_bulk(db, kill_ids: list[str]) -> dict[str, dict]:
    """Bulk-fetch the current ai_annotations row for each kill_id."""
    if not kill_ids:
        return {}
    out: dict[str, dict] = {}
    in_filter = "in.(" + ",".join(kill_ids) + ")"
    try:
        r = httpx.get(
            f"{db.base}/ai_annotations",
            headers=db.headers,
            params={
                "select": "kill_id,confidence_score,highlight_score,model_name",
                "kill_id": in_filter,
                "is_current": "eq.true",
                "limit": 5000,
            },
            timeout=20.0,
        )
        if r.status_code != 200:
            log.debug("qc_sampler_anno_fetch_skipped",
                      status=r.status_code, body=r.text[:120])
            return {}
        for row in r.json() or []:
            kid = row.get("kill_id")
            if kid:
                out[kid] = row
    except Exception as e:
        log.debug("qc_sampler_anno_fetch_error", error=str(e)[:120])
    return out


def _fetch_pending_report_counts(db, kill_ids: list[str]) -> dict[str, int]:
    """Return {kill_id: pending_report_count} for the given kill ids.

    Reads `reports` table (migration 032) with status='pending'. Returns
    an empty dict if the table doesn't exist yet (pre-032 deployments)
    or any HTTP error happens — the caller treats missing entries as 0.

    PostgREST doesn't expose GROUP BY directly via the REST surface, so
    we fetch the raw rows and count client-side. With our partial index
    (idx_reports_pending) and the upper bound of SAMPLE_POOL_SIZE * a
    handful of pending reports each, the row count stays bounded.
    """
    if not kill_ids:
        return {}
    out: dict[str, int] = {}
    in_filter = "in.(" + ",".join(kill_ids) + ")"
    try:
        r = httpx.get(
            f"{db.base}/reports",
            headers=db.headers,
            params={
                "select": "target_id",
                "target_type": "eq.kill",
                "target_id": in_filter,
                "status": "eq.pending",
                "limit": 5000,
            },
            timeout=15.0,
        )
        if r.status_code != 200:
            log.debug(
                "qc_sampler_reports_fetch_skipped",
                status=r.status_code,
                body=r.text[:120],
            )
            return {}
        for row in r.json() or []:
            kid = row.get("target_id")
            if kid:
                out[kid] = out.get(kid, 0) + 1
    except Exception as e:
        log.debug("qc_sampler_reports_fetch_error", error=str(e)[:120])
    return out


def _fetch_verified_vod_set(db, vod_ids: list[str]) -> set[str]:
    """Return the set of vod_youtube_ids that have at least one
    successfully verified qc.verify job. A kill from a brand-new VOD with
    no prior verification gets the +0.4 risk bump.

    Looks at both pipeline_jobs (status='succeeded') and worker_jobs
    (status='completed') so the signal is preserved across the migration
    window from worker_jobs → pipeline_jobs.
    """
    if not vod_ids:
        return set()
    verified_kill_ids: list[str] = []
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()

        # Modern path : pipeline_jobs
        r = httpx.get(
            f"{db.base}/pipeline_jobs",
            headers=db.headers,
            params={
                "select": "entity_id,result,status",
                "type": "eq.qc.verify",
                "entity_type": "eq.kill",
                "status": "eq.succeeded",
                "created_at": f"gte.{cutoff}",
                "limit": 2000,
            },
            timeout=20.0,
        )
        if r.status_code == 200:
            for row in r.json() or []:
                res = row.get("result") or {}
                if isinstance(res, dict) and res.get("status") in (None, "ok", "pass"):
                    eid = row.get("entity_id")
                    if eid:
                        verified_kill_ids.append(eid)

        # Legacy path : worker_jobs (kept for the migration window)
        r2 = httpx.get(
            f"{db.base}/worker_jobs",
            headers=db.headers,
            params={
                "select": "payload,result,status",
                "kind": "eq.clip_qc.verify",
                "status": "eq.completed",
                "requested_at": f"gte.{cutoff}",
                "limit": 2000,
            },
            timeout=20.0,
        )
        if r2.status_code == 200:
            for row in r2.json() or []:
                pl = row.get("payload") or {}
                res = row.get("result") or {}
                if isinstance(res, dict) and res.get("status") in (None, "ok", "pass"):
                    kid = pl.get("kill_id") if isinstance(pl, dict) else None
                    if kid:
                        verified_kill_ids.append(kid)

        if not verified_kill_ids:
            return set()

        # Look up their vod_youtube_ids in batches.
        verified_vods: set[str] = set()
        BATCH = 200
        for i in range(0, len(verified_kill_ids), BATCH):
            batch = verified_kill_ids[i : i + BATCH]
            in_filter = "in.(" + ",".join(batch) + ")"
            r3 = httpx.get(
                f"{db.base}/kills",
                headers=db.headers,
                params={
                    "select": "vod_youtube_id",
                    "id": in_filter,
                    "vod_youtube_id": "not.is.null",
                    "limit": BATCH,
                },
                timeout=20.0,
            )
            if r3.status_code == 200:
                for kr in r3.json() or []:
                    v = kr.get("vod_youtube_id")
                    if v:
                        verified_vods.add(v)
        return verified_vods
    except Exception as e:
        log.debug("qc_sampler_verified_vods_error", error=str(e)[:120])
        return set()


# ─── Risk scoring ───────────────────────────────────────────────────────

def compute_qc_risk(
    kill: dict,
    asset: dict | None,
    annotation: dict | None,
    *,
    verified_vods: set[str] | None = None,
    has_ffmpeg_warning: bool = False,
    user_reported: bool = False,
    pending_report_count: int = 0,
) -> float:
    """Return a non-negative risk score for this published kill.

    The score is the sum of all triggered bumps. A 2% random baseline is
    added so the looks-fine population still gets unbiased coverage.

    `user_reported` is kept for back-compat with callers that haven't
    been updated yet — when both it and `pending_report_count` are
    supplied, the count wins. `pending_report_count` is the source of
    truth coming from the `reports` table (migration 032).
    """
    score = 0.0

    # Random 2% baseline
    if random.random() < RANDOM_BASELINE_RATE:
        score += 1.0

    # Asset-based bumps
    if asset is not None:
        offset = asset.get("source_offset_seconds")
        # Heuristic : vof2-discovered offsets tend to land on non-round
        # second values (e.g. 1247) whereas livestats anchors land on
        # integer multiples reflecting the 10s frame cadence. We rely on
        # the source_offset_seconds being non-null to mean "vof2 ran".
        # The clipper writes it for vof2 paths; livestats-anchor clipping
        # leaves it null. If migration 026 isn't applied the asset is
        # None and this branch is skipped.
        if offset is not None:
            score += RISK_VOF2_OFFSET
        duration_ms = asset.get("duration_ms") or kill.get("duration_ms")
        if duration_ms is not None:
            try:
                d = int(duration_ms)
                if d < 15_000 or d > 30_000:
                    score += RISK_WEIRD_DURATION
            except (TypeError, ValueError):
                pass

    # Data source bump
    if (kill.get("data_source") or "").lower() == "gol_gg":
        score += RISK_GOLGG_SOURCE

    # Highlight score extremes
    hs = kill.get("highlight_score")
    if hs is not None:
        try:
            hs_f = float(hs)
            if hs_f >= 9.0 or hs_f <= 3.0:
                score += RISK_EXTREME_SCORE
        except (TypeError, ValueError):
            pass

    # AI confidence bump
    if annotation is not None:
        conf = annotation.get("confidence_score")
        if conf is not None:
            try:
                if float(conf) < 0.5:
                    score += RISK_LOW_CONFIDENCE
            except (TypeError, ValueError):
                pass

    # First kill from this VOD
    if verified_vods is not None:
        vod = kill.get("vod_youtube_id")
        if vod and vod not in verified_vods:
            score += RISK_FIRST_FROM_VOD

    # ffmpeg warning recently
    if has_ffmpeg_warning:
        score += RISK_FFMPEG_WARNING

    # User reports — read from migration 032 `reports` table.
    # ≥1 pending report → +1.0 ("user-flagged is high signal").
    # ≥3 pending reports → +0.5 extra ("very confident bad").
    # `user_reported` boolean is the legacy back-compat path : if a
    # caller still passes the old flag without the count, treat as
    # exactly one pending report.
    effective_count = pending_report_count
    if effective_count <= 0 and user_reported:
        effective_count = 1
    if effective_count > 0:
        score += RISK_USER_REPORTED
        if effective_count >= RISK_HEAVY_REPORT_THRESHOLD:
            score += RISK_USER_REPORTED_HEAVY

    return score


# ─── Job enqueue ────────────────────────────────────────────────────────

def _enqueue_qc_job(kill_id: str, risk_score: float) -> str | None:
    """Enqueue a qc.verify job in pipeline_jobs (PR23-arch).

    Uses services.job_queue.enqueue, which honours the unique constraint
    on (type, entity_type, entity_id) WHERE status IN ('pending','claimed')
    — so a duplicate enqueue while a job is still pending is a silent
    no-op (returns None, no error). The dedup window check upstream
    handles the longer-term "we already QC'd this kill last week" case.

    The risk_score is stuffed into the payload so the job_runner /
    admin UI can later display "why was this picked".
    """
    return job_queue.enqueue(
        "qc.verify",
        entity_type="kill",
        entity_id=kill_id,
        payload={
            "source": "qc_sampler",
            "risk_score": round(risk_score, 3),
        },
        priority=60,
    )


# ─── Daemon entry point ──────────────────────────────────────────────────

@run_logged()
async def run() -> int:
    """Score recent published clips by risk, enqueue clip_qc.verify on
    anything above RISK_THRESHOLD (cap = SAMPLE_PICK_SIZE).
    """
    # Team-aware observability (PR-loltok BA) — log tracked team count so
    # operators can correlate QC volume with the worker's deployment mode.
    tracked = team_config.load_tracked_teams()
    log.info(
        "qc_sampler_start",
        strategy="risk_based",
        tracked_teams=len(tracked),
    )

    db = get_db()
    if not db:
        return 0

    pool = await _fetch_recent_published(db)
    if not pool:
        log.info("qc_sampler_no_pool")
        return 0

    pool_ids = [r["id"] for r in pool if r.get("id")]
    already = await _fetch_already_qcd(db, pool_ids)
    eligible_rows = [r for r in pool if r.get("id") and r["id"] not in already]

    if not eligible_rows:
        log.info(
            "qc_sampler_all_qcd",
            pool=len(pool_ids),
            already=len(already),
        )
        return 0

    # Bulk-fetch context for risk scoring
    eligible_ids = [r["id"] for r in eligible_rows]
    assets_by_kill = _fetch_assets_bulk(db, eligible_ids)
    annos_by_kill = _fetch_annotations_bulk(db, eligible_ids)
    reports_by_kill = _fetch_pending_report_counts(db, eligible_ids)
    vod_ids = [r.get("vod_youtube_id") for r in eligible_rows if r.get("vod_youtube_id")]
    verified_vods = _fetch_verified_vod_set(db, vod_ids)

    # Score every candidate
    scored: list[tuple[float, dict]] = []
    for kill in eligible_rows:
        kid = kill["id"]
        # Confidence from annotation overrides any inline kills.confidence
        risk = compute_qc_risk(
            kill,
            asset=assets_by_kill.get(kid),
            annotation=annos_by_kill.get(kid),
            verified_vods=verified_vods,
            has_ffmpeg_warning=False,    # no ffmpeg-warning table yet
            pending_report_count=reports_by_kill.get(kid, 0),
        )
        if risk >= RISK_THRESHOLD:
            scored.append((risk, kill))

    if not scored:
        log.info("qc_sampler_no_risky", pool=len(pool_ids), eligible=len(eligible_rows))
        return 0

    # Highest risk first, cap at SAMPLE_PICK_SIZE
    scored.sort(key=lambda t: t[0], reverse=True)
    pick = scored[:SAMPLE_PICK_SIZE]

    enqueued = 0
    for risk, kill in pick:
        job_id = _enqueue_qc_job(kill["id"], risk)
        if job_id:
            enqueued += 1
            log.info(
                "qc_sampler_enqueued",
                kill_id=kill["id"][:8],
                job_id=job_id[:8],
                risk=round(risk, 2),
            )
        else:
            log.warn("qc_sampler_enqueue_failed", kill_id=kill["id"][:8])

    log.info(
        "qc_sampler_done",
        pool=len(pool_ids),
        eligible=len(eligible_rows),
        already_qcd=len(already),
        risky=len(scored),
        enqueued=enqueued,
        reported_kills=sum(1 for v in reports_by_kill.values() if v > 0),
        heavy_reported=sum(1 for v in reports_by_kill.values() if v >= RISK_HEAVY_REPORT_THRESHOLD),
        avg_risk=round(sum(r for r, _ in pick) / max(1, len(pick)), 2),
        max_risk=round(pick[0][0], 2) if pick else 0.0,
    )
    return enqueued
