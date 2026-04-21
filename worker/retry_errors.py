"""Move kills stuck in clip_error back to vod_found so the clipper retries.

Only retries kills with retry_count < MAX_RETRIES to avoid infinite loops.
Kills that have already been retried that many times stay in clip_error
for manual investigation via /admin/clips.

Usage:
    python retry_errors.py              # dry-run
    python retry_errors.py --apply      # actually requeue
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
MAX_RETRIES = 3


def req(method: str, url: str, body: bytes | None = None) -> list[dict] | None:
    r = urllib.request.Request(url, data=body, method=method, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    })
    with urllib.request.urlopen(r, timeout=30) as resp:
        data = resp.read()
        if not data:
            return []
        try:
            return json.loads(data)
        except Exception:
            return []


def main() -> None:
    apply_mode = "--apply" in sys.argv

    # Find all clip_error kills with retry_count < MAX_RETRIES
    url = (
        f"{SUPABASE_URL}/rest/v1/kills"
        "?select=id,retry_count,game_id"
        "&status=eq.clip_error"
        f"&retry_count=lt.{MAX_RETRIES}"
        "&limit=500"
    )
    rows = req("GET", url) or []
    print(f"\n{len(rows)} clip_error kills with retry_count < {MAX_RETRIES}\n")

    if not apply_mode:
        print("(dry-run — add --apply to actually requeue)")
        return

    if not rows:
        return

    # Batch update — PostgREST doesn't support IN clause directly on PATCH
    # but we can iterate. Alternative: use RPC, but iteration is clearer.
    ok = 0
    for row in rows:
        kill_id = row["id"]
        patch_url = f"{SUPABASE_URL}/rest/v1/kills?id=eq.{kill_id}"
        body = json.dumps({"status": "vod_found"}).encode()
        try:
            req("PATCH", patch_url, body)
            ok += 1
        except Exception as e:
            print(f"  FAIL {kill_id[:8]}: {e}")
    print(f"\nOK  Requeued {ok}/{len(rows)} kills")


if __name__ == "__main__":
    main()
