# -*- coding: utf-8 -*-
"""
REPAIR_PUBLISHED_URLS — Resynchronise kills.clip_url_* depuis kill_assets.

Contexte (docs/ETAT_DES_LIEUX_2026-07-14.md §3) : 272 kills 'published'
n'ont AUCUNE URL sur la ligne kills alors que leurs 4 assets courants
existent sur R2 (bug du status-flip batch de mai 2026 : 23505 sur
content_hash → fallback → le PATCH d'URLs n'est jamais passé).

Réparation DB pure, AUCUN re-clip, AUCUN appel externe hors Supabase.
Le PATCH ne contient JAMAIS content_hash (piège 23505, spec P4).

Usage :
    python scripts/repair_published_urls.py             # dry-run (défaut)
    python scripts/repair_published_urls.py --apply     # écrit
    python scripts/repair_published_urls.py --all-statuses  # pas que published
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.supabase_client import get_db, safe_update  # noqa: E402

ASSET_TYPE_TO_COLUMN = {
    "horizontal": "clip_url_horizontal",
    "vertical": "clip_url_vertical",
    "vertical_low": "clip_url_vertical_low",
    "thumbnail": "thumbnail_url",
    "og_image": "og_image_url",
}


def fetch_all(db, table, params):
    rows, offset = [], 0
    client = db._get_client()
    while True:
        p = {**params, "limit": "1000", "offset": str(offset)}
        r = client.get(f"{db.base}/{table}", params=p)
        r.raise_for_status()
        batch = r.json() or []
        rows.extend(batch)
        if len(batch) < 1000:
            return rows
        offset += 1000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="écrit en DB (défaut : dry-run)")
    ap.add_argument("--all-statuses", action="store_true",
                    help="répare aussi analyzed/clipped, pas que published")
    args = ap.parse_args()

    db = get_db()
    if db is None:
        print("Supabase indisponible")
        return 1

    statuses = ("published,analyzed,clipped" if args.all_statuses
                else "published")
    broken = fetch_all(db, "kills", {
        "select": "id,status,clip_url_vertical,clip_url_horizontal,"
                  "clip_url_vertical_low,thumbnail_url,og_image_url",
        "status": f"in.({statuses})",
        "clip_url_vertical": "is.null",
    })
    print(f"kills {statuses} sans clip_url_vertical : {len(broken)}")
    if not broken:
        return 0

    ids = [k["id"] for k in broken]
    assets_by_kill: dict[str, dict[str, str]] = defaultdict(dict)
    for i in range(0, len(ids), 60):
        chunk = ids[i:i + 60]
        assets = fetch_all(db, "kill_assets", {
            "select": "kill_id,type,url",
            "kill_id": f"in.({','.join(chunk)})",
            "is_current": "eq.true",
        })
        for a in assets:
            col = ASSET_TYPE_TO_COLUMN.get(a["type"])
            if col and a.get("url"):
                assets_by_kill[a["kill_id"]][col] = a["url"]

    repaired, partial, hopeless = 0, 0, 0
    for k in broken:
        urls = assets_by_kill.get(k["id"], {})
        # ne patcher que les colonnes vides — jamais écraser une URL existante
        patch = {col: url for col, url in urls.items() if not k.get(col)}
        if not patch:
            hopeless += 1
            continue
        has_core = "clip_url_vertical" in {**urls} and "clip_url_horizontal" in urls
        if args.apply:
            ok = safe_update("kills", patch, "id", k["id"])
            if ok:
                repaired += 1 if has_core else 0
                partial += 0 if has_core else 1
        else:
            repaired += 1 if has_core else 0
            partial += 0 if has_core else 1

    mode = "APPLIQUÉ" if args.apply else "DRY-RUN"
    print(f"[{mode}] réparables complets: {repaired} | partiels: {partial} "
          f"| sans assets: {hopeless}")
    if hopeless:
        no_assets = [k["id"] for k in broken if not assets_by_kill.get(k["id"])]
        print(f"  sans AUCUN asset courant (à re-clipper) : {len(no_assets)}")
        for kid in no_assets[:10]:
            print(f"    {kid}")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    raise SystemExit(main())
