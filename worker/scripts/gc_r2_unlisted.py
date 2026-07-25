"""gc_r2_unlisted.py — GC INVERSE : les objets R2 que la base ne trace pas.

CONSTAT (dry-run du 2026-07-25) : R2 contient 113 541 objets (1 093 GB) mais
kill_assets n'en trace que 68 898. Il reste donc ~44 600 objets SANS aucune
ligne en base — invisibles pour gc_r2_orphans.py, qui parcourt kill_assets.
C'est le residu de l'ancien layout plat (double upload corrige en juillet) et
c'est la que pese le gros du stockage.

METHODE (inverse du GC classique) : on liste R2, et on soustrait l'ensemble
des references construit depuis TOUTE la base. Ce qui reste n'est designe par
rien : ni par une URL de kills, ni par un manifest, ni par une ligne asset.

GARDE-FOUS (leçon de l'incident QC du 2026-07-25 — un outil aveugle qui
condamne ; et du piege r2-gc-clip-url-trap) :
  1. Le set de references vient de build_reference_set() (deja durci : un
     scan de table en echec leve, il ne "continue" plus en silence).
  2. Abort si le set est suspicieusement petit (< 1000).
  3. Abort si les cles connues de kill_assets ne sont pas majoritairement
     couvertes -> preuve que la lecture de la base a bien fonctionne.
  4. PREFIXES PROTEGES : backups/ (notre filet !), og/ (referencees par
     og_image_url), moments/, moment_thumbs/.
  5. Les objets de moins de MIN_AGE_H heures sont EPARGNES : un clip vient
     peut-etre d'etre uploade et sa ligne n'est pas encore ecrite.
  6. Suppression par lots avec controle de sante : on re-interroge des URLs
     REFERENCEES apres chaque lot ; a la moindre qui ne repond plus, ABORT.

Usage :
  python scripts/gc_r2_unlisted.py                    # analyse (dry-run)
  python scripts/gc_r2_unlisted.py --delete --limit 500
  python scripts/gc_r2_unlisted.py --delete           # tout
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from dotenv import load_dotenv
load_dotenv(_ROOT / ".env")

from gc_r2_orphans import (  # noqa: E402
    build_reference_set, load_assets, url_to_path, head_ok, CLIP_HOSTS,
)

PROTECTED_PREFIXES = ("backups/", "og/", "moments/", "moment_thumbs/")
MIN_AGE_H = 48


def list_r2(client, bucket: str) -> list[dict]:
    out, tok = [], None
    while True:
        kw = {"Bucket": bucket, "MaxKeys": 1000}
        if tok:
            kw["ContinuationToken"] = tok
        p = client.list_objects_v2(**kw)
        out.extend({"Key": o["Key"], "Size": o["Size"],
                    "LastModified": o["LastModified"]} for o in p.get("Contents", []))
        if not p.get("IsTruncated"):
            return out
        tok = p.get("NextContinuationToken")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--delete", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--batch", type=int, default=200)
    args = ap.parse_args()

    print("=" * 66)
    print("  gc_r2_unlisted — GC INVERSE (objets R2 non traces en base)")
    print(f"  mode: {'DELETE' if args.delete else 'ANALYSE (dry-run)'}")
    print("=" * 66)

    print("\n[1/5] Set de references (toutes tables)...")
    refs = build_reference_set()
    print(f"  => {len(refs)} paths references")
    if len(refs) < 1000:
        print("  ABORT : set de references suspicieusement petit")
        return 1

    print("\n[2/5] Cles connues de kill_assets (preuve de lecture DB)...")
    assets = load_assets()
    known = {a.get("r2_key") for a in assets if a.get("r2_key")}
    known |= {url_to_path(a.get("url")) for a in assets if a.get("url")}
    known.discard(None)
    print(f"  => {len(assets)} rows, {len(known)} cles distinctes")
    if len(known) < 10000:
        print("  ABORT : trop peu de cles connues, lecture DB douteuse")
        return 1

    print("\n[3/5] Listing R2...")
    from services.storage_factory import get_storage_backend
    storage = get_storage_backend()
    client = storage._get_client()
    objs = list_r2(client, storage._bucket)
    print(f"  => {len(objs)} objets, {sum(o['Size'] for o in objs)/1024**3:.1f} GB")

    print("\n[4/5] Classification...")
    cutoff = datetime.now(timezone.utc) - timedelta(hours=MIN_AGE_H)
    protected = recent = referenced = tracked = 0
    dead: list[dict] = []
    for o in objs:
        k = o["Key"]
        if k.startswith(PROTECTED_PREFIXES):
            protected += 1
            continue
        lm = o["LastModified"]
        if lm.tzinfo is None:
            lm = lm.replace(tzinfo=timezone.utc)
        if lm > cutoff:
            recent += 1
            continue
        if k in refs:
            referenced += 1
            continue
        if k in known:
            tracked += 1      # a une ligne asset -> c'est le job de gc_r2_orphans
            continue
        dead.append(o)
    gb = sum(o["Size"] for o in dead) / 1024 ** 3
    print(f"  proteges (backups/og/moments)   : {protected}")
    print(f"  trop recents (<{MIN_AGE_H}h)             : {recent}")
    print(f"  REFERENCES (intouchables)       : {referenced}")
    print(f"  traces en base (autre GC)       : {tracked}")
    print(f"  MORTS (rien ne les designe)     : {len(dead)}  (~{gb:.1f} GB)")

    print("\n[5/5] Sondage HEAD...")
    ref_sample = random.sample([k for k in refs if k], min(10, len(refs)))
    bad = 0
    for k in ref_sample:
        c = head_ok(CLIP_HOSTS[0] + k)
        if c != 200:
            bad += 1
        print(f"    [{c}] REF {k[-58:]}")
    if bad:
        print(f"  ABORT : {bad}/10 references ne repondent pas 200")
        return 1

    if not args.delete:
        rep = _ROOT / "gc_r2_unlisted_report.json"
        rep.write_text(json.dumps({
            "dead_count": len(dead), "dead_gb": round(gb, 1),
            "protected": protected, "recent": recent,
            "referenced": referenced, "tracked": tracked,
            "sample": [d["Key"] for d in dead[:40]],
        }, indent=2), encoding="utf-8")
        print(f"\n(dry-run — aucune suppression). rapport: {rep}")
        return 0

    todo = dead[: args.limit] if args.limit else dead
    print(f"\nSuppression de {len(todo)} objets morts par lots de {args.batch}...")
    done = 0
    for i in range(0, len(todo), args.batch):
        chunk = [{"Key": o["Key"]} for o in todo[i:i + args.batch]]
        r = client.delete_objects(Bucket=storage._bucket,
                                  Delete={"Objects": chunk, "Quiet": True})
        errs = r.get("Errors", [])
        done += len(chunk) - len(errs)
        # sante : des URLs REFERENCEES doivent toujours repondre
        hb = sum(1 for k in random.sample(ref_sample, 3)
                 if head_ok(CLIP_HOSTS[0] + k) != 200)
        print(f"  lot {i//args.batch+1}: deleted={done} failed={len(errs)} "
              f"health={'OK' if hb == 0 else 'FAIL'}")
        if hb:
            print("  ABORT : une reference a cesse de repondre.")
            return 1
        time.sleep(0.3)
    print(f"\nBILAN: {done} objets supprimes (~{gb:.1f} GB vises)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
