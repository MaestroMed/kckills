"""
live_dashboard.py — Terminal dashboard refreshed every 5s.

Run :
    cd worker
    python scripts/live_dashboard.py

Press Ctrl+C to exit. Zero deps beyond what the worker already uses.

Shows :
  * PUBLISHED count + delta-since-launch
  * pipeline_jobs by status + by kind
  * Recent ai_annotations (per minute throughput estimate)
  * Active claims (oldest age)
  * DLQ count + top 3 error_codes
  * Worker freshness (last log line age)

Use this instead of staring at the worker logs — it's a single-screen
ANSI-cleared snapshot that updates in place. Friendlier than tail -F.
"""

from __future__ import annotations

import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv

load_dotenv()

URL = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get(
    "SUPABASE_SERVICE_KEY"
)
HEADERS = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Accept": "application/json"}

# ANSI escapes — Windows terminals from Win10 1607+ support them via
# VT processing (auto-enabled by Python on win32 in recent versions).
CLEAR = "\033[H\033[J"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
CYAN = "\033[36m"
GOLD = "\033[38;5;178m"  # close to KC gold

REFRESH_SECONDS = 5

# Track baselines from the first cycle so deltas are session-relative.
_baseline: dict[str, int] = {}
_baseline_at: float | None = None


def cnt(client: httpx.Client, table: str, **filters: str) -> int:
    params = {"select": "id", "limit": "1", **filters}
    r = client.get(
        f"{URL}/{table}",
        headers={**HEADERS, "Prefer": "count=exact"},
        params=params,
        timeout=10,
    )
    if r.status_code != 200:
        return -1
    return int((r.headers.get("content-range") or "0-0/0").split("/")[-1])


def fetch_dlq_top_errors(client: httpx.Client) -> list[tuple[str, str, int]]:
    r = client.get(
        f"{URL}/dead_letter_jobs",
        headers=HEADERS,
        params={
            "select": "type,error_code",
            "or": "(resolution_status.is.null,resolution_status.eq.pending)",
            "limit": "500",
        },
        timeout=10,
    )
    if r.status_code != 200:
        return []
    rows = r.json()
    grouped: Counter[tuple[str, str]] = Counter()
    for row in rows:
        grouped[(row.get("type") or "?", row.get("error_code") or "?")] += 1
    return [(t, c, n) for (t, c), n in grouped.most_common(3)]


def fetch_oldest_claim_age_s(client: httpx.Client) -> int | None:
    r = client.get(
        f"{URL}/pipeline_jobs",
        headers=HEADERS,
        params={
            "select": "claimed_at",
            "status": "eq.claimed",
            "order": "claimed_at.asc",
            "limit": "1",
        },
        timeout=10,
    )
    if r.status_code != 200:
        return None
    rows = r.json()
    if not rows or not rows[0].get("claimed_at"):
        return None
    try:
        dt = datetime.fromisoformat(rows[0]["claimed_at"].replace("Z", "+00:00"))
        return int((datetime.now(timezone.utc) - dt).total_seconds())
    except Exception:
        return None


def fmt_int(n: int) -> str:
    if n < 0:
        return f"{RED}err{RESET}"
    return f"{n:,}"


def fmt_delta(now: int, key: str) -> str:
    base = _baseline.get(key)
    if base is None or _baseline_at is None:
        return ""
    delta = now - base
    age_min = max(1, int((time.time() - _baseline_at) / 60))
    rate = delta / age_min if age_min else 0
    sign = "+" if delta >= 0 else ""
    color = GREEN if delta > 0 else (DIM if delta == 0 else RED)
    return f" {color}{sign}{delta:,}{RESET} {DIM}({rate:+.1f}/min){RESET}"


def fmt_age(s: int | None) -> str:
    if s is None:
        return f"{DIM}-{RESET}"
    if s < 60:
        return f"{GREEN}{s}s{RESET}"
    if s < 3600:
        return f"{YELLOW}{s // 60}m{s % 60:02d}s{RESET}"
    color = RED if s > 7200 else YELLOW
    return f"{color}{s // 3600}h{(s % 3600) // 60:02d}m{RESET}"


def render(client: httpx.Client) -> None:
    global _baseline, _baseline_at

    published = cnt(client, "kills", **{"status": "eq.published"})
    analyzed = cnt(client, "kills", **{"status": "eq.analyzed"})
    enriched = cnt(client, "kills", **{"status": "eq.enriched"})
    cliperror = cnt(client, "kills", **{"status": "eq.clip_error"})
    annotations = cnt(client, "ai_annotations")

    pj_pending = cnt(client, "pipeline_jobs", **{"status": "eq.pending"})
    pj_claimed = cnt(client, "pipeline_jobs", **{"status": "eq.claimed"})
    pj_succeeded = cnt(client, "pipeline_jobs", **{"status": "eq.succeeded"})
    pj_failed = cnt(client, "pipeline_jobs", **{"status": "eq.failed"})
    dlq_total = cnt(
        client, "dead_letter_jobs",
        **{"or": "(resolution_status.is.null,resolution_status.eq.pending)"},
    )

    if not _baseline:
        _baseline = {
            "published": published,
            "annotations": annotations,
            "pj_succeeded": pj_succeeded,
        }
        _baseline_at = time.time()

    oldest_claim = fetch_oldest_claim_age_s(client)
    dlq_top = fetch_dlq_top_errors(client)

    out = [CLEAR]
    out.append(f"{GOLD}{BOLD}╔══ KCKILLS WORKER LIVE — {datetime.now().strftime('%H:%M:%S')} ══╗{RESET}\n\n")

    out.append(f"  {BOLD}KILLS PUBLISHED{RESET}        {GOLD}{fmt_int(published)}{RESET}{fmt_delta(published, 'published')}\n")
    out.append(f"  ai_annotations         {fmt_int(annotations)}{fmt_delta(annotations, 'annotations')}\n")
    out.append(f"  analyzed (waiting)     {fmt_int(analyzed)}\n")
    out.append(f"  enriched (in queue)    {fmt_int(enriched)}\n")
    out.append(f"  clip_error (legacy)    {fmt_int(cliperror)}\n\n")

    out.append(f"  {BOLD}PIPELINE_JOBS{RESET}\n")
    out.append(f"    pending              {fmt_int(pj_pending)}\n")
    out.append(f"    claimed (in flight)  {fmt_int(pj_claimed)}    oldest claim age: {fmt_age(oldest_claim)}\n")
    out.append(f"    succeeded            {fmt_int(pj_succeeded)}{fmt_delta(pj_succeeded, 'pj_succeeded')}\n")
    out.append(f"    failed (DLQ)         {fmt_int(pj_failed)}\n\n")

    out.append(f"  {BOLD}DEAD LETTER QUEUE{RESET}    unresolved: {fmt_int(dlq_total)}\n")
    if dlq_top:
        for kind, code, n in dlq_top:
            out.append(f"    {DIM}{n:>4d} {kind:24s} {code}{RESET}\n")

    out.append(f"\n  {DIM}refresh every {REFRESH_SECONDS}s — Ctrl+C to exit{RESET}\n")
    sys.stdout.write("".join(out))
    sys.stdout.flush()


def main() -> int:
    if not KEY:
        print("Missing SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return 1

    # Enable Win10+ ANSI passthrough.
    if sys.platform == "win32":
        try:
            import ctypes

            kernel32 = ctypes.windll.kernel32
            kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
        except Exception:
            pass

    with httpx.Client() as client:
        try:
            while True:
                render(client)
                time.sleep(REFRESH_SECONDS)
        except KeyboardInterrupt:
            sys.stdout.write(f"\n{DIM}exit{RESET}\n")
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
