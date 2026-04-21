"""Check worker heartbeat — shows when the daemon last pinged Supabase.

Usage:  python check_heartbeat.py
"""

from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def main() -> None:
    url = f"{SUPABASE_URL}/rest/v1/health_checks?select=*&id=eq.worker_heartbeat"
    req = urllib.request.Request(url, headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    })
    with urllib.request.urlopen(req, timeout=15) as r:
        rows = json.loads(r.read())

    if not rows:
        print("No heartbeat row — daemon has never pinged.")
        return

    hb = rows[0]
    ls = hb.get("last_seen", "")
    metrics = hb.get("metrics") or {}

    if ls:
        dt = datetime.fromisoformat(ls.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        age_s = int((now - dt).total_seconds())
        # The heartbeat module runs every 6h (21600s). Use 2× that + slack
        # as the offline threshold so a single skipped cycle doesn't
        # falsely alarm.
        status = "[HEALTHY]" if age_s < 45000 else "[OFFLINE]"
        age_str = f"{age_s}s" if age_s < 3600 else f"{age_s // 60}m" if age_s < 86400 else f"{age_s // 3600}h"
        print(f"\n{status}  last ping {age_str} ago  ({ls})\n")

    if metrics:
        print("Metrics:")
        for k, v in metrics.items():
            if isinstance(v, dict):
                print(f"  {k}:")
                for kk, vv in v.items():
                    print(f"    {kk}: {vv}")
            else:
                print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
