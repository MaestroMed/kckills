# -*- coding: utf-8 -*-
"""
BACKFILL_GOLGG_DATES — date (et semaine) des matchs importés de gol.gg.

Les 472 « matchs » gol.gg (une ligne par game, external_id golgg_match_<id>)
n'avaient pas de scheduled_at : le parseur de la liste de matchs ne lisait
que le format JJ/MM/AAAA alors que gol.gg affiche AAAA-MM-JJ. Conséquence
constatée le 24/09/2026 : 4 461 clips visibles (la moitié du catalogue)
absents des ères de la frise (« 0 KILLS » de 2021 à Winter 2025) et mal
triés sur /matches.

La page de chaque game gol.gg porte l'en-tête « KC vs GIANTX LEC 2026 Spring
Season (EUW) - Fearless Draft 2026-05-10 (WEEK7) » : on en tire la date et
la phase. Seuls les champs vides sont écrits. Rythme poli (délai du client
GolggClient).

Usage :
  python scripts/backfill_golgg_dates.py            # rapport
  python scripts/backfill_golgg_dates.py --apply
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv()
from services.golgg_scraper import GolggClient  # noqa: E402
from services.supabase_client import get_db  # noqa: E402

HEADER = re.compile(r"(\d{4}-\d{2}-\d{2})\s*\(([^)]{1,40})\)")
LOG = Path(r"D:\kckills_worker\logs")


def parse(html: str) -> tuple[str | None, str | None]:
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))
    m = HEADER.search(text)
    if m:
        return m.group(1), m.group(2).strip().title()
    d = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", text)
    return (d.group(1) if d else None), None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    db = get_db()
    client = db._get_client()
    headers = {**db.headers, "Prefer": "return=minimal"}
    rows = client.get(f"{db.base}/matches", params={
        "select": "id,external_id,stage", "external_id": "like.golgg_match_*",
        "scheduled_at": "is.null", "limit": "2000"}).json()
    if args.limit:
        rows = rows[: args.limit]
    print(f"matchs gol.gg sans date : {len(rows)}", flush=True)
    golgg = GolggClient()
    done, missed, journal = 0, [], []
    for i, m in enumerate(rows, 1):
        gid = m["external_id"].rsplit("_", 1)[-1]
        try:
            date, stage = parse(golgg._fetch(f"/game/stats/{gid}/page-game/"))
        except Exception as e:  # une page en erreur ne bloque pas le lot
            missed.append((gid, str(e)[:80]))
            continue
        if not date:
            missed.append((gid, "date introuvable"))
            continue
        patch = {"scheduled_at": f"{date}T12:00:00Z"}
        if stage and not (m.get("stage") or "").strip():
            patch["stage"] = stage
        journal.append({"id": m["id"], "external_id": m["external_id"], **patch})
        if args.apply:
            r = client.patch(f"{db.base}/matches", params={"id": f"eq.{m['id']}", "scheduled_at": "is.null"},
                             json=patch, headers=headers)
            done += r.status_code < 400
        if i % 25 == 0:
            print(f"  {i}/{len(rows)} (dernier : {m['external_id']} -> {date} {stage or ''})", flush=True)
    LOG.mkdir(parents=True, exist_ok=True)
    path = LOG / f"backfill_golgg_dates_{time.strftime('%Y%m%d_%H%M%S')}.json"
    path.write_text(json.dumps({"apply": args.apply, "rows": journal, "missed": missed}, ensure_ascii=False, indent=1),
                    encoding="utf-8")
    print(f"dates trouvées : {len(journal)} | écrites : {done} | ratées : {len(missed)} — journal {path}")


if __name__ == "__main__":
    main()
