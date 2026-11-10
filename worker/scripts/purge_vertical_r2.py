"""
PURGE_VERTICAL_R2 — supprime les v.mp4 (9:16 HQ) du bucket R2, accord de
Mehdi le 07/11/2026 (« go suppression »).

Préalable : scripts/repoint_vertical_to_h.py --apply (plus rien ne pointe
sur un v.mp4). Ce script re-vérifie quand même : toute clé encore
référencée en base (kills, moments, kill_assets courants ; l'historique
non courant ne protège pas) est épargnée, ainsi que
tout objet modifié depuis moins de 2 h (clip frais d'un démon pas encore
écrit en base).

Cible : clés finissant par « /v.mp4 » (versionné) ou « _v.mp4 » (legacy,
moments m_<id>_v.mp4). v_low, h, thumbnails : jamais touchés.

  python scripts/purge_vertical_r2.py            # dry-run : compte + taille
  python scripts/purge_vertical_r2.py --apply    # supprime + journal

Journal : logs/purge_vertical_<ts>.jsonl (clé, taille). Pas de retour
arrière : un v.mp4 se refait en reclippant, et le site n'en a plus besoin.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import time
from pathlib import Path

import boto3
import httpx
from dotenv import load_dotenv

load_dotenv(Path.cwd() / ".env")
URL = os.environ["SUPABASE_URL"]
KEY = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
BUCKET = os.getenv("R2_BUCKET_NAME", "loltok-clips")
PUBLIC = os.getenv("R2_PUBLIC_URL", "").rstrip("/")
FRESH_S = 2 * 3600


LOW = False  # --low : cible les v_low (régime R2 du 09/11/2026)


def is_target(key: str) -> bool:
    if LOW:
        return key.endswith("/v_low.mp4") or key.endswith("_v_low.mp4")
    return key.endswith("/v.mp4") or (key.endswith("_v.mp4") and not key.endswith("_v_low.mp4"))


def to_key(url: str) -> str:
    u = url.split("?")[0]
    if PUBLIC and u.startswith(PUBLIC + "/"):
        return u[len(PUBLIC) + 1:]
    return u.split("/", 3)[-1] if u.startswith("http") else u


def referenced() -> set[str]:
    refs: set[str] = set()
    specs = [
        ("kills", "id,clip_url_vertical,clip_url_horizontal,clip_url_vertical_low"),
        ("moments", "id,clip_url_vertical,clip_url_horizontal,clip_url_vertical_low"),
        ("kill_assets", "id,url,r2_key"),
    ]
    with httpx.Client(timeout=60) as c:
        for table, sel in specs:
            off = 0
            while True:
                r = c.get(f"{URL}/rest/v1/{table}", headers=H,
                          params={"select": sel, "order": "id", "limit": 1000, "offset": off,
                                  **({"is_current": "eq.true"} if table == "kill_assets" else {})})
                r.raise_for_status()
                rows = r.json()
                for row in rows:
                    for k, v in row.items():
                        if k != "id" and isinstance(v, str) and v:
                            refs.add(v if k == "r2_key" else to_key(v))
                if len(rows) < 1000:
                    break
                off += 1000
    return refs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--low", action="store_true")
    a = ap.parse_args()
    global LOW
    LOW = a.low

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )
    refs = referenced()
    print(f"références en base : {len(refs)}")

    now = dt.datetime.now(dt.timezone.utc)
    targets, kept_ref, kept_fresh = [], 0, 0
    total_objs = total_bytes = 0
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET):
        for o in page.get("Contents", []):
            total_objs += 1
            total_bytes += o["Size"]
            k = o["Key"]
            if not is_target(k):
                continue
            if k in refs:
                kept_ref += 1
            elif (now - o["LastModified"]).total_seconds() < FRESH_S:
                kept_fresh += 1
            else:
                targets.append((k, o["Size"]))
    tb = sum(s for _, s in targets)
    print(f"bucket : {total_objs} objets, {total_bytes / 1e9:.1f} Go")
    print(f"v.mp4 à supprimer : {len(targets)} ({tb / 1e9:.1f} Go) ; "
          f"épargnés : {kept_ref} référencés, {kept_fresh} frais")
    for k, _ in targets[:3]:
        print("  ex.", k)
    if not a.apply:
        print("dry-run")
        return

    log = Path("logs") / f"purge_vertical_{time.strftime('%Y%m%d_%H%M%S')}.jsonl"
    log.parent.mkdir(exist_ok=True)
    fails = 0
    with log.open("w", encoding="utf-8") as f:
        for i in range(0, len(targets), 1000):
            chunk = targets[i:i + 1000]
            r = s3.delete_objects(Bucket=BUCKET, Delete={"Objects": [{"Key": k} for k, _ in chunk], "Quiet": True})
            bad = {e["Key"] for e in r.get("Errors", [])}
            fails += len(bad)
            for k, sz in chunk:
                f.write(json.dumps({"key": k, "size": sz, "ok": k not in bad}) + "\n")
            print(f"  {min(i + 1000, len(targets))}/{len(targets)}")
    print(f"fini, journal {log.resolve()}, échecs : {fails}")


if __name__ == "__main__":
    main()
