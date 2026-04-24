#!/usr/bin/env python3
"""Weekly pipeline report generator.

Pulls the last 7 days of pipeline metrics from Supabase REST and renders
a Markdown summary, then opens (or updates) a GitHub issue titled
"Pipeline weekly report - YYYY-WW".

The issue carries the `weekly-report` label so the team can filter for
historical reports in the issue tracker.

Required environment variables :
    SUPABASE_URL          full https://<project>.supabase.co URL
    SUPABASE_SERVICE_KEY  service role key
    GITHUB_TOKEN          auto-provided by GitHub Actions
    GITHUB_REPOSITORY     owner/repo, auto-provided by Actions

Run locally with the same env vars to dry-run the report (it will still
hit the live GitHub API — set GITHUB_REPOSITORY to a sandbox repo first).
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

import requests


def env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        sys.stderr.write(f"Missing required env var {name}\n")
        sys.exit(1)
    return v


SUPABASE_URL = env("SUPABASE_URL").rstrip("/")
SUPABASE_KEY = env("SUPABASE_SERVICE_KEY")
GITHUB_TOKEN = env("GITHUB_TOKEN")
GITHUB_REPO = env("GITHUB_REPOSITORY")

SUPA_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}

now = datetime.now(timezone.utc)
week_start = now - timedelta(days=7)
prev_week_start = now - timedelta(days=14)
iso_week = now.strftime("%G-W%V")
issue_title = f"Pipeline weekly report - {iso_week}"


# ─── Supabase REST helpers ─────────────────────────────────────────────


def supa_get(table: str, params: dict[str, str]) -> list[dict[str, Any]]:
    """GET against PostgREST. Falls back to [] on 404 (table missing)."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    try:
        r = requests.get(url, headers=SUPA_HEADERS, params=params, timeout=20)
    except requests.RequestException as exc:
        sys.stderr.write(f"[supa_get {table}] network error: {exc}\n")
        return []
    if r.status_code == 404:
        sys.stderr.write(f"[supa_get {table}] table not found, skipping\n")
        return []
    if not r.ok:
        sys.stderr.write(f"[supa_get {table}] {r.status_code}: {r.text[:200]}\n")
        return []
    try:
        return r.json()
    except json.JSONDecodeError:
        return []


def supa_count(table: str, filters: dict[str, str]) -> int:
    """HEAD with Prefer: count=exact to get the row count without payload."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {**SUPA_HEADERS, "Prefer": "count=exact", "Range": "0-0"}
    try:
        r = requests.get(url, headers=headers, params={**filters, "select": "id"}, timeout=20)
    except requests.RequestException as exc:
        sys.stderr.write(f"[supa_count {table}] network error: {exc}\n")
        return 0
    if r.status_code == 404:
        return 0
    if not r.ok:
        sys.stderr.write(f"[supa_count {table}] {r.status_code}: {r.text[:200]}\n")
        return 0
    cr = r.headers.get("Content-Range", "")
    # Format: "0-0/123" — split on "/"
    if "/" in cr:
        try:
            return int(cr.split("/")[-1])
        except ValueError:
            return 0
    return 0


# ─── Data fetchers ─────────────────────────────────────────────────────


def fetch_pipeline_runs() -> list[dict[str, Any]]:
    return supa_get(
        "pipeline_runs",
        {
            "select": "module,status,started_at,finished_at,error_message",
            "started_at": f"gte.{week_start.isoformat()}",
            "order": "started_at.desc",
            "limit": "5000",
        },
    )


def fetch_dead_letter() -> list[dict[str, Any]]:
    return supa_get(
        "dead_letter_jobs",
        {
            "select": "module,reason,created_at",
            "created_at": f"gte.{week_start.isoformat()}",
            "order": "created_at.desc",
            "limit": "1000",
        },
    )


def fetch_kills_count(start: datetime, end: datetime) -> int:
    return supa_count(
        "kills",
        {
            "created_at": f"gte.{start.isoformat()}",
            f"created_at": f"lt.{end.isoformat()}",
        },
    )


def fetch_published_count(start: datetime, end: datetime) -> int:
    return supa_count(
        "kills",
        {
            "status": "eq.published",
            "updated_at": f"gte.{start.isoformat()}",
        },
    )


def fetch_clip_errors_count(start: datetime) -> int:
    return supa_count(
        "kills",
        {
            "status": "eq.clip_error",
            "updated_at": f"gte.{start.isoformat()}",
        },
    )


# ─── Markdown rendering ────────────────────────────────────────────────


def fmt_int(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def render_report(
    pipeline_runs: list[dict[str, Any]],
    dead_letters: list[dict[str, Any]],
    kills_this_week: int,
    kills_last_week: int,
    published_this_week: int,
    clip_errors_this_week: int,
) -> str:
    delta = kills_this_week - kills_last_week
    delta_pct = (delta / kills_last_week * 100) if kills_last_week else 0.0
    arrow = "▲" if delta > 0 else ("▼" if delta < 0 else "·")

    # Module grouping for pipeline_runs
    module_counts: Counter[tuple[str, str]] = Counter()
    for r in pipeline_runs:
        module = r.get("module") or "unknown"
        status = r.get("status") or "unknown"
        module_counts[(module, status)] += 1
    modules = sorted({m for m, _ in module_counts.keys()})

    # Module grouping for dead_letters
    dl_counts: Counter[str] = Counter()
    for r in dead_letters:
        dl_counts[r.get("module") or "unknown"] += 1

    lines: list[str] = []
    lines.append(f"# Pipeline weekly report — {iso_week}")
    lines.append("")
    lines.append(
        f"_Generated {now.strftime('%Y-%m-%d %H:%M UTC')} for the period "
        f"{week_start.strftime('%Y-%m-%d')} → {now.strftime('%Y-%m-%d')}._"
    )
    lines.append("")

    # ── Headline KPIs ────────────────────────────────────────────────
    lines.append("## Headline metrics")
    lines.append("")
    lines.append("| Metric | This week | Last week | Δ |")
    lines.append("| --- | ---: | ---: | ---: |")
    lines.append(
        f"| Kills inserted | {fmt_int(kills_this_week)} | {fmt_int(kills_last_week)} | "
        f"{arrow} {fmt_int(abs(delta))} ({delta_pct:+.1f}%) |"
    )
    lines.append(f"| Newly published clips | {fmt_int(published_this_week)} | — | — |")
    lines.append(f"| Clip errors | {fmt_int(clip_errors_this_week)} | — | — |")
    lines.append("")

    # ── Pipeline runs by module ──────────────────────────────────────
    lines.append("## Pipeline runs by module")
    lines.append("")
    if not modules:
        lines.append("_No pipeline_runs rows in the last 7 days._")
    else:
        all_statuses = sorted({s for _, s in module_counts.keys()})
        header = "| Module | " + " | ".join(all_statuses) + " | Total |"
        sep = "| --- |" + " ---: |" * (len(all_statuses) + 1)
        lines.append(header)
        lines.append(sep)
        for m in modules:
            row_total = 0
            cells: list[str] = []
            for s in all_statuses:
                n = module_counts.get((m, s), 0)
                row_total += n
                cells.append(fmt_int(n))
            lines.append(f"| `{m}` | " + " | ".join(cells) + f" | **{fmt_int(row_total)}** |")
    lines.append("")

    # ── Dead-letter queue ────────────────────────────────────────────
    lines.append("## Dead-letter jobs")
    lines.append("")
    if not dead_letters:
        lines.append("_No dead-letter jobs this week — pipeline is healthy._")
    else:
        lines.append("| Module | Count |")
        lines.append("| --- | ---: |")
        for m, n in sorted(dl_counts.items(), key=lambda kv: kv[1], reverse=True):
            lines.append(f"| `{m}` | {fmt_int(n)} |")
        lines.append("")
        lines.append(f"**Total dead-letters : {fmt_int(len(dead_letters))}**")
    lines.append("")

    # ── Footer ───────────────────────────────────────────────────────
    lines.append("---")
    lines.append("")
    lines.append(
        "Generated automatically by `.github/workflows/weekly-pipeline-report.yml`. "
        "Edit the script at `.github/scripts/weekly_report.py` to change what's tracked."
    )
    return "\n".join(lines)


# ─── GitHub API ────────────────────────────────────────────────────────

GH_API = "https://api.github.com"
GH_HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


def find_existing_issue() -> int | None:
    """Look for an open issue with the same title — if present we update
    it instead of creating a duplicate. Manual re-runs of the workflow
    on the same week thus refresh the existing report."""
    url = f"{GH_API}/repos/{GHOWNER}/{GHREPO}/issues"
    params = {"state": "open", "labels": "weekly-report", "per_page": "100"}
    try:
        r = requests.get(url, headers=GH_HEADERS, params=params, timeout=20)
    except requests.RequestException as exc:
        sys.stderr.write(f"[gh issues list] network error: {exc}\n")
        return None
    if not r.ok:
        sys.stderr.write(f"[gh issues list] {r.status_code}: {r.text[:200]}\n")
        return None
    for issue in r.json():
        if issue.get("title") == issue_title:
            return int(issue["number"])
    return None


def ensure_label() -> None:
    """Best-effort: create the `weekly-report` label if it's missing.
    Failure is non-fatal — the issue creation succeeds either way."""
    url = f"{GH_API}/repos/{GHOWNER}/{GHREPO}/labels"
    body = {
        "name": "weekly-report",
        "color": "5319e7",
        "description": "Automated weekly pipeline reports",
    }
    try:
        r = requests.post(url, headers=GH_HEADERS, json=body, timeout=20)
        if r.status_code in (201, 422):  # 422 = already exists
            return
        sys.stderr.write(f"[gh labels create] {r.status_code}: {r.text[:200]}\n")
    except requests.RequestException as exc:
        sys.stderr.write(f"[gh labels create] network error: {exc}\n")


def create_issue(body: str) -> int | None:
    url = f"{GH_API}/repos/{GHOWNER}/{GHREPO}/issues"
    payload = {"title": issue_title, "body": body, "labels": ["weekly-report"]}
    try:
        r = requests.post(url, headers=GH_HEADERS, json=payload, timeout=20)
    except requests.RequestException as exc:
        sys.stderr.write(f"[gh issue create] network error: {exc}\n")
        return None
    if not r.ok:
        sys.stderr.write(f"[gh issue create] {r.status_code}: {r.text[:200]}\n")
        return None
    return int(r.json()["number"])


def update_issue(number: int, body: str) -> bool:
    url = f"{GH_API}/repos/{GHOWNER}/{GHREPO}/issues/{number}"
    try:
        r = requests.patch(url, headers=GH_HEADERS, json={"body": body}, timeout=20)
    except requests.RequestException as exc:
        sys.stderr.write(f"[gh issue update] network error: {exc}\n")
        return False
    if not r.ok:
        sys.stderr.write(f"[gh issue update] {r.status_code}: {r.text[:200]}\n")
        return False
    return True


# ─── Main ──────────────────────────────────────────────────────────────


GHOWNER, GHREPO = GITHUB_REPO.split("/", 1)


def main() -> int:
    print(f"Fetching pipeline runs since {week_start.isoformat()}")
    pipeline_runs = fetch_pipeline_runs()
    print(f"  → {len(pipeline_runs)} runs")

    print("Fetching dead-letter jobs")
    dead_letters = fetch_dead_letter()
    print(f"  → {len(dead_letters)} dead-letter jobs")

    print("Counting kills (this week)")
    kills_this_week = fetch_kills_count(week_start, now)
    print(f"  → {kills_this_week} kills this week")

    print("Counting kills (previous week)")
    kills_last_week = fetch_kills_count(prev_week_start, week_start)
    print(f"  → {kills_last_week} kills last week")

    print("Counting newly-published clips")
    published_this_week = fetch_published_count(week_start, now)
    print(f"  → {published_this_week} newly published")

    print("Counting clip errors")
    clip_errors_this_week = fetch_clip_errors_count(week_start)
    print(f"  → {clip_errors_this_week} clip errors")

    body = render_report(
        pipeline_runs,
        dead_letters,
        kills_this_week,
        kills_last_week,
        published_this_week,
        clip_errors_this_week,
    )

    print("\n--- Report preview ---\n" + body[:1200] + ("\n..." if len(body) > 1200 else ""))

    ensure_label()
    existing = find_existing_issue()
    if existing:
        print(f"Updating existing issue #{existing}")
        ok = update_issue(existing, body)
        return 0 if ok else 1

    print("Creating new issue")
    number = create_issue(body)
    if number is None:
        return 1
    print(f"Created issue #{number}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
