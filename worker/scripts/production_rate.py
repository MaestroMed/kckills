"""
production_rate.py - One-shot CLI snapshot of pipeline throughput.

Wave 20.4 (2026-05-08) - created so the operator can answer
"what's our production rate ?" with a single command instead of
hand-writing SQL queries against Supabase.

Sections produced :
  1. Publication rate (kills going `published` per window).
  2. Detection rate (sentinel + harvester intake).
  3. Pipeline_jobs throughput (succeeded / failed / DLQ over 24h).
  4. Catalog status distribution + blocked-bucket diagnosis.
  5. Stuck-pocket analysis (vod_found, analyzed) - kills that should
     be advancing but aren't.

Run :
    .venv\\Scripts\\python.exe worker\\scripts\\production_rate.py

Reads from env :
  SUPABASE_URL + SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY).

Cheap : ~10 PostgREST calls, ~3-5 s wall time. No write side-effects,
safe to spam during incidents.

Output is intentionally pure-ASCII so Windows cp1252 consoles
(default `powershell.exe`) don't crash on the bar characters.
"""

from __future__ import annotations

import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone

import httpx
from dotenv import load_dotenv

load_dotenv()


def _env_or_die() -> tuple[str, dict[str, str]]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = (
        os.environ.get("SUPABASE_SERVICE_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or ""
    )
    if not url or not key:
        sys.stderr.write(
            "Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in env.\n"
        )
        raise SystemExit(2)
    return url + "/rest/v1", {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }


def _count(
    base: str,
    auth: dict[str, str],
    table: str,
    params: dict[str, str],
) -> int | None:
    """Single-trip count. Uses httpx.get directly (not a Client) to avoid
    the Wave 20.4 httpx-Client header-merge surprise where per-request
    headers shadowed Authorization on some Windows + httpx 0.28 setups."""
    r = httpx.get(
        f"{base}/{table}",
        params={**params, "select": "id", "limit": "1"},
        headers={**auth, "Prefer": "count=exact"},
        timeout=30,
    )
    # PostgREST returns 206 (Partial Content) when count=exact + limit=1
    # because the response body has fewer rows than the total count.
    # Both 200 (full) and 206 (partial) are success cases for us — we
    # only care about the content-range header.
    if r.status_code not in (200, 206):
        return None
    cr = r.headers.get("content-range", "")
    if "/" not in cr:
        return None
    tail = cr.rsplit("/", 1)[-1]
    return int(tail) if tail.isdigit() else None


def section_publication_rate(base: str, auth: dict[str, str]) -> None:
    print("=" * 64)
    print("  PUBLICATION RATE  (kills.status='published', by updated_at)")
    print("=" * 64)
    now = datetime.now(timezone.utc)
    rows: list[tuple[str, datetime]] = [
        ("1h", now - timedelta(hours=1)),
        ("6h", now - timedelta(hours=6)),
        ("24h", now - timedelta(hours=24)),
        ("7d", now - timedelta(days=7)),
        ("30d", now - timedelta(days=30)),
    ]
    print(f"  {'window':<6}  {'published':>10}  {'/hour':>8}  {'/day':>9}")
    print(f"  {'-' * 6}  {'-' * 10}  {'-' * 8}  {'-' * 9}")
    for label, since in rows:
        n = _count(
            base, auth, "kills",
            {
                "status": "eq.published",
                "updated_at": f"gte.{since.isoformat()}",
            },
        )
        hours = (now - since).total_seconds() / 3600
        if n is None:
            print(f"  {label:<6}  {'?':>10}")
            continue
        rh = n / hours if hours > 0 else 0
        rd = rh * 24
        print(f"  {label:<6}  {n:>10}  {rh:>8.2f}  {rd:>9.2f}")
    print()


def section_detection_rate(base: str, auth: dict[str, str]) -> None:
    print("=" * 64)
    print("  DETECTION RATE  (kills.created_at, all statuses)")
    print("=" * 64)
    now = datetime.now(timezone.utc)
    rows: list[tuple[str, datetime]] = [
        ("1h", now - timedelta(hours=1)),
        ("24h", now - timedelta(hours=24)),
        ("7d", now - timedelta(days=7)),
        ("30d", now - timedelta(days=30)),
    ]
    print(f"  {'window':<6}  {'detected':>10}  {'/hour':>8}")
    print(f"  {'-' * 6}  {'-' * 10}  {'-' * 8}")
    for label, since in rows:
        n = _count(
            base, auth, "kills",
            {"created_at": f"gte.{since.isoformat()}"},
        )
        hours = (now - since).total_seconds() / 3600
        if n is None:
            print(f"  {label:<6}  {'?':>10}")
            continue
        rh = n / hours if hours > 0 else 0
        print(f"  {label:<6}  {n:>10}  {rh:>8.2f}")
    print()


def section_jobs_24h(base: str, auth: dict[str, str]) -> None:
    print("=" * 64)
    print("  PIPELINE_JOBS THROUGHPUT  (last 24h)")
    print("=" * 64)
    yday = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    for status in ("succeeded", "failed", "dead_letter"):
        n = _count(
            base, auth, "pipeline_jobs",
            {"status": f"eq.{status}", "updated_at": f"gte.{yday}"},
        )
        marker = " " if status != "dead_letter" or (n or 0) == 0 else "!"
        print(f"  {marker} {status:<14}  {n if n is not None else '?':>8}")

    # Current queue depth
    print()
    print("  Current queue depth :")
    for status in ("pending", "claimed", "failed"):
        n = _count(base, auth, "pipeline_jobs", {"status": f"eq.{status}"})
        marker = "!" if status == "failed" and (n or 0) > 1000 else " "
        print(f"  {marker} {status:<14}  {n if n is not None else '?':>8}")
    print()


def section_status_distribution(base: str, auth: dict[str, str]) -> None:
    print("=" * 64)
    print("  KILLS CATALOG STATUS DISTRIBUTION")
    print("=" * 64)
    statuses = (
        "raw",
        "enriched",
        "vod_found",
        "clipping",
        "clipped",
        "analyzed",
        "published",
        "clip_error",
        "manual_review",
    )
    counts = {}
    for s in statuses:
        n = _count(base, auth, "kills", {"status": f"eq.{s}"})
        counts[s] = n
    total = sum(v for v in counts.values() if v is not None) or 1
    for s in statuses:
        n = counts[s]
        if n is None:
            print(f"    {s:<14}  {'?':>8}")
            continue
        pct = n / total * 100
        bar = "#" * int(pct / 2.5)
        marker = "*" if s == "published" else " "
        print(f"  {marker} {s:<14}  {n:>8}  {pct:>5.1f}%  {bar}")
    print(f"    {'TOTAL':<14}  {total:>8}")
    print()


def section_blocked_diagnosis(base: str, auth: dict[str, str]) -> None:
    """Surface the 'why are kills stuck' picture for the operator."""
    print("=" * 64)
    print("  BLOCKED-BUCKET DIAGNOSIS")
    print("=" * 64)

    # 1. Raw kills that come from games WITHOUT a VOD - unactionable
    #    until a YouTube ID is discovered. Common with gol.gg historical
    #    imports where the CSV gives kill data but no broadcast link.
    n_completed_no_vod = _count(
        base, auth, "games",
        {"state": "eq.completed", "vod_youtube_id": "is.null"},
    )
    n_completed_with_vod = _count(
        base, auth, "games",
        {"state": "eq.completed", "vod_youtube_id": "not.is.null"},
    )
    print(f"  Games state='completed', no VOD : {n_completed_no_vod}")
    print(f"  Games state='completed', has VOD : {n_completed_with_vod}")
    if n_completed_no_vod and n_completed_no_vod > 50:
        print(
            "    -> these are the source of most 'raw' kills. "
            "Run vod_hunter against them, or accept as data-only."
        )
    print()

    # 2. vod_found kills with claim-state breakdown (have VOD, waiting
    #    for clipper). If `clip.create` jobs are stacking pending,
    #    the dispatcher is rate-limited but progressing ; if they're
    #    all failed, something's broken in the clipper.
    print("  vod_found kills + their pipeline_jobs state :")
    n_vod_found = _count(base, auth, "kills", {"status": "eq.vod_found"})
    print(f"    kills.status=vod_found        : {n_vod_found}")
    for jstatus in ("pending", "claimed", "failed"):
        n = _count(
            base, auth, "pipeline_jobs",
            {"type": "eq.clip.create", "status": f"eq.{jstatus}"},
        )
        marker = (
            "!"
            if jstatus == "failed" and (n or 0) > 100
            else " "
        )
        print(f"  {marker} clip.create jobs {jstatus:<8}  : {n}")
    print()

    # 3. clip_error retry distribution - recoverable subset
    print("  clip_error kills (sample 1000) :")
    r = httpx.get(
        f"{base}/kills",
        params={
            "select": "retry_count",
            "status": "eq.clip_error",
            "limit": "1000",
        },
        headers=auth,
        timeout=30,
    )
    rows = r.json() if r.status_code == 200 else []
    rd: Counter[int] = Counter(
        (k.get("retry_count") or 0) for k in rows
    )
    for rc in sorted(rd):
        bar_len = (rd[rc] * 30 // max(rd.values())) if rd else 0
        bar = "+" * bar_len
        print(f"    retry_count={rc}  {rd[rc]:>4}  {bar}")
    if rd:
        recoverable = sum(n for rc, n in rd.items() if rc < 5)
        print(
            f"    -> {recoverable} have retry_count<5 - runnable via "
            "`recover_exhausted_clip_errors.py` if root cause is "
            "transient (yt-dlp 429, R2 hiccup)."
        )
    print()


def main() -> int:
    base, auth = _env_or_die()
    section_publication_rate(base, auth)
    section_detection_rate(base, auth)
    section_jobs_24h(base, auth)
    section_status_distribution(base, auth)
    section_blocked_diagnosis(base, auth)
    print("=" * 64)
    print("  Snapshot done. For the live admin view, see /admin/pipeline.")
    print("=" * 64)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
