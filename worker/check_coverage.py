"""Check coverage of optional fields on published kills.

Usage:  python check_coverage.py
"""

from __future__ import annotations

import json
import os
import urllib.request

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def count(filters: str) -> int:
    """HEAD count using exact Content-Range trick."""
    url = f"{SUPABASE_URL}/rest/v1/kills?select=id{filters}"
    req = urllib.request.Request(url, method="HEAD", headers={
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Prefer": "count=exact",
        "Range-Unit": "items",
        "Range": "0-0",
    })
    with urllib.request.urlopen(req, timeout=15) as r:
        cr = r.headers.get("Content-Range", "0-0/0")
        return int(cr.split("/")[-1])


def main() -> None:
    pub = count("&status=eq.published")
    print(f"\n=== Coverage on {pub} published kills ===\n")

    fields = [
        ("clip_url_vertical",     "&clip_url_vertical=not.is.null"),
        ("clip_url_horizontal",   "&clip_url_horizontal=not.is.null"),
        ("thumbnail_url",         "&thumbnail_url=not.is.null"),
        ("og_image_url",          "&og_image_url=not.is.null"),
        ("hls_master_url",        "&hls_master_url=not.is.null"),
        ("ai_description",        "&ai_description=not.is.null"),
        ("highlight_score",       "&highlight_score=not.is.null"),
        ("killer_player_id",      "&killer_player_id=not.is.null"),
        ("fight_type",            "&fight_type=not.is.null"),
        ("kill_visible=true",     "&kill_visible=eq.true"),
    ]
    for name, f in fields:
        n = count(f"&status=eq.published{f}")
        pct = 100.0 * n / pub if pub else 0.0
        bar = "#" * int(pct / 5)
        print(f"  {name:<24}  {n:>4}/{pub}  {pct:>5.1f}%  {bar}")


if __name__ == "__main__":
    main()
