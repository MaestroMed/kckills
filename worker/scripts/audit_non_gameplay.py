# -*- coding: utf-8 -*-
"""
AUDIT_NON_GAMEPLAY — patrouille : clips publiés dont l'image n'est pas du jeu.

Reprend l'audit du 29/09/2026 (1 149 clips hors jeu sortis du feed) pour
les clips passés par un chemin sans porte (scripts de re-clip, pipeline
manuel, anciens lots) :

  1. kills encore dans le feed dont la vignette n'a pas été auditée
     (état local : kill_id -> thumbnail_url, un re-clip est donc re-audité) ;
  2. vignette R2 -> p(sans jeu) (modules/gameplay_gate) ;
  3. suspects (p ≥ 0,3) -> 5 images du clip vertical, lues sur R2 par seek
     HTTP (10/30/50/70/90 %) ;
  4. ≥ 3 images sur 5 sans jeu -> candidat à la quarantaine
     (quarantine_non_gameplay.py) ; 1-2 -> « vignette seule / fin de game »,
     laissé en ligne et listé dans le rapport.

Usage :
  python scripts/audit_non_gameplay.py                  # rapport + candidats
  python scripts/audit_non_gameplay.py --apply          # + quarantaine journalisée
  python scripts/audit_non_gameplay.py --since-days 2   # clips récents seulement
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
from modules import gameplay_gate  # noqa: E402
from services.supabase_client import get_db  # noqa: E402

REPORT_DIR = Path(r"D:\kckills_worker\audit_non_gameplay")
STATE = REPORT_DIR / "state.json"
SUSPECT_P = 0.3
PUBLISHED_OR = "(publication_status.eq.published,and(publication_status.is.null,status.eq.published))"


def fetch_feed(db, since_days: int | None) -> list[dict]:
    client, rows, off = db._get_client(), [], 0
    params = {"select": "id,thumbnail_url,clip_url_vertical,tracked_team_involvement,created_at",
              "or": PUBLISHED_OR, "kill_visible": "not.is.false", "thumbnail_url": "not.is.null",
              "order": "id", "limit": "1000"}
    if since_days:
        params["updated_at"] = "gte." + (datetime.now(timezone.utc) - timedelta(days=since_days)).isoformat()
    while True:
        r = client.get(f"{db.base}/kills", params={**params, "offset": str(off)})
        r.raise_for_status()
        page = r.json() or []
        rows += page
        if len(page) < 1000:
            return rows
        off += 1000


async def score_thumbnails(rows: list[dict], tmp: Path) -> dict[str, float]:
    sem = asyncio.Semaphore(16)
    paths: dict[str, Path] = {}

    async def dl(client, k):
        async with sem:
            try:
                r = await client.get(k["thumbnail_url"])
                if r.status_code == 200 and r.content:
                    p = tmp / f"{k['id']}.jpg"
                    p.write_bytes(r.content)
                    paths[k["id"]] = p
            except Exception:
                pass

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        await asyncio.gather(*(dl(client, k) for k in rows))
    ids = list(paths)
    out: dict[str, float] = {}
    for i in range(0, len(ids), 16):
        chunk = ids[i:i + 16]
        p = await asyncio.to_thread(gameplay_gate.score_paths, [str(paths[k]) for k in chunk])
        if p is None:
            raise RuntimeError("porte indisponible (torch / open_clip, voir requirements-vision.txt)")
        out.update(zip(chunk, p))
    return out


async def main_async(args) -> None:
    db = get_db()
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() and not args.reset else {}
    rows = [k for k in fetch_feed(db, args.since_days) if state.get(k["id"]) != k["thumbnail_url"]]
    print(f"clips du feed à auditer : {len(rows)}")
    tmp = Path(tempfile.mkdtemp(prefix="audit_ng_"))
    p_thumb = await score_thumbnails(rows, tmp)
    by_id = {k["id"]: k for k in rows}
    suspects = [kid for kid, p in p_thumb.items() if p >= SUSPECT_P]
    print(f"vignettes notées : {len(p_thumb)} | suspectes (p ≥ {SUSPECT_P}) : {len(suspects)}")
    sem = asyncio.Semaphore(6)
    verdicts: dict[str, gameplay_gate.GateResult] = {}

    async def check(kid):
        async with sem:
            url = by_id[kid].get("clip_url_vertical")
            verdicts[kid] = (await gameplay_gate.check_clip(url, crop_vertical=False) if url
                             else gameplay_gate.GateResult("skipped", detail="pas de clip vertical"))

    await asyncio.gather(*(check(k) for k in suspects))
    cands = [{"kill_id": kid, "category": "audit",
              "evidence": f"patrouille {time.strftime('%Y-%m-%d')} vignette p_ng={p_thumb[kid]:.2f} "
                          f"{verdicts[kid].detail}"}
             for kid in suspects if verdicts[kid].verdict == "fail"]
    thumb_only = [kid for kid in suspects if verdicts[kid].verdict in ("pass", "warn")]
    skipped = [kid for kid in suspects if verdicts[kid].verdict == "skipped"]
    stamp = time.strftime("%Y%m%d_%H%M%S")
    cpath = REPORT_DIR / f"candidates_{stamp}.json"
    cpath.write_text(json.dumps(cands, ensure_ascii=False, indent=0), encoding="utf-8")
    (REPORT_DIR / f"report_{stamp}.json").write_text(json.dumps({
        "audited": len(p_thumb), "suspects": len(suspects), "non_gameplay": len(cands),
        "thumbnail_only": thumb_only, "skipped": {k: verdicts[k].detail for k in skipped},
        "frames": {k: verdicts[k].p for k in suspects}}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"sans jeu (≥ 3/5 images) : {len(cands)} | vignette seule : {len(thumb_only)} "
          f"| non vérifiés : {len(skipped)}\ncandidats : {cpath}")
    for kid in p_thumb:
        if kid not in skipped:
            state[kid] = by_id[kid]["thumbnail_url"]
    STATE.write_text(json.dumps(state), encoding="utf-8")
    if args.apply and cands:
        from scripts.quarantine_non_gameplay import run as quarantine
        quarantine(cpath, apply=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="met en quarantaine les clips sans jeu")
    ap.add_argument("--since-days", type=int, default=None)
    ap.add_argument("--reset", action="store_true", help="ignore l'état : ré-audite tout le feed")
    asyncio.run(main_async(ap.parse_args()))


if __name__ == "__main__":
    main()
