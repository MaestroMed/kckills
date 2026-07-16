"""Nettoyage du préfixe hls/ (~40 GB de segments jamais servis).

ORDRE OBLIGATOIRE (règle GC référence-based) :
  1. DB d'abord : NULL kills.hls_master_url (le front fallback déjà sur le MP4
     quand c'est null — FeedPlayerPool force hlsUrl=null de toute façon).
  2. Ensuite seulement : delete hls/* sur R2 (les deletes R2 sont gratuits).

Usage : .venv/Scripts/python.exe scripts/cleanup_hls_prefix.py [--dry-run]
"""
from __future__ import annotations

import sys
sys.path.insert(0, ".")

import httpx
from services.supabase_client import get_db
from services.storage_factory import get_storage_backend

DRY = "--dry-run" in sys.argv


def main() -> None:
    db = get_db()
    # 1. DB first — count then NULL the column.
    r = httpx.get(f"{db.base}/kills", headers={**db.headers, "Prefer": "count=exact"},
                  params={"select": "id", "hls_master_url": "not.is.null", "limit": "1"},
                  timeout=30)
    total = int((r.headers.get("content-range") or "0/0").split("/")[-1] or 0)
    print(f"kills avec hls_master_url : {total}")
    if not DRY and total:
        pr = httpx.patch(f"{db.base}/kills",
                         headers={**db.headers, "Prefer": "return=minimal"},
                         params={"hls_master_url": "not.is.null"},
                         json={"hls_master_url": None}, timeout=120)
        print(f"NULL hls_master_url -> HTTP {pr.status_code}")
        if pr.status_code >= 400:
            print("ABANDON : la DB doit être nettoyée AVANT les objets.")
            return

    # 2. R2 : list + delete hls/* par lots de 1000.
    storage = get_storage_backend()
    client = storage._get_client()
    bucket = storage._bucket
    deleted = 0
    token = None
    while True:
        kw = {"Bucket": bucket, "Prefix": "hls/", "MaxKeys": 1000}
        if token:
            kw["ContinuationToken"] = token
        page = client.list_objects_v2(**kw)
        keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
        if not keys:
            break
        if DRY:
            deleted += len(keys)
        else:
            resp = client.delete_objects(Bucket=bucket, Delete={"Objects": keys, "Quiet": True})
            deleted += len(keys) - len(resp.get("Errors", []))
        if not page.get("IsTruncated"):
            break
        token = page.get("NextContinuationToken")
        if deleted % 10000 < 1000:
            print(f"  ... {deleted} objets")
    label = "[DRY-RUN] objets hls/ a supprimer" if DRY else "objets hls/ supprimes"
    print(f"{label} : {deleted}")


if __name__ == "__main__":
    main()
