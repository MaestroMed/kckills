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

La phase est écrite au format de l'API lolesports (« Week 7 », « Round 1 »,
« Play-In · Day 3 »), comme les matchs officiels. --normalize-stages remet à
ce format les phases déjà en base (« Week7 », « Knockoutstage », « Semaine 3 »,
« Play-offs »…).

Usage :
  python scripts/backfill_golgg_dates.py            # rapport
  python scripts/backfill_golgg_dates.py --apply
  python scripts/backfill_golgg_dates.py --normalize-stages [--apply]
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


_WORDS = {"knockoutstage": "Knockout Stage", "groupstage": "Group Stage", "play-in": "Play-In",
          "play-offs": "Playoffs", "playoffs": "Playoffs"}


def clean_stage(raw: str | None) -> str | None:
    """« WEEK7 » -> « Week 7 », « PLAY-IN.DAY3 » -> « Play-In · Day 3 », « Semaine 3 » -> « Week 3 »."""
    if not raw or not raw.strip():
        return raw
    parts = []
    for part in raw.strip().split("."):
        p = part.strip()
        m = re.fullmatch(r"(week|semaine|round|day)\s*(\d+)", p, re.I)
        if m:
            word = "Week" if m.group(1).lower() in ("week", "semaine") else m.group(1).title()
            parts.append(f"{word} {int(m.group(2))}")
        else:
            parts.append(_WORDS.get(p.lower(), p if any(c.islower() for c in p[1:]) else p.title()))
    return " · ".join(parts)


def parse(html: str) -> tuple[str | None, str | None]:
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))
    m = HEADER.search(text)
    if m:
        return m.group(1), clean_stage(m.group(2))
    d = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", text)
    return (d.group(1) if d else None), None


def normalize_stages(client, db, headers, apply: bool) -> None:
    rows, off = [], 0
    while True:
        page = client.get(f"{db.base}/matches", params={
            "select": "id,external_id,stage", "stage": "not.is.null", "offset": str(off), "limit": "1000"}).json()
        rows += page
        if len(page) < 1000:
            break
        off += 1000
    todo = [(m, clean_stage(m["stage"])) for m in rows if clean_stage(m["stage"]) != m["stage"]]
    done = 0
    for m, new in todo:
        if apply:
            # garde : on ne réécrit que si la phase n'a pas bougé depuis la lecture
            r = client.patch(f"{db.base}/matches", params={"id": f"eq.{m['id']}", "stage": f"eq.{m['stage']}"},
                             json={"stage": new}, headers=headers)
            done += r.status_code < 400
    LOG.mkdir(parents=True, exist_ok=True)
    path = LOG / f"normalize_stages_{time.strftime('%Y%m%d_%H%M%S')}.json"
    path.write_text(json.dumps({"apply": apply, "rows": [{"id": m["id"], "external_id": m["external_id"],
                                                          "old": m["stage"], "new": new} for m, new in todo]},
                               ensure_ascii=False, indent=1), encoding="utf-8")
    sample = sorted({(m["stage"], new) for m, new in todo})
    print(f"phases à reformater : {len(todo)} | écrites : {done} — journal {path}")
    for old, new in sample:
        print(f"  {old!r} -> {new!r}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--normalize-stages", action="store_true")
    args = ap.parse_args()
    db = get_db()
    client = db._get_client()
    headers = {**db.headers, "Prefer": "return=minimal"}
    if args.normalize_stages:
        normalize_stages(client, db, headers, args.apply)
        return
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
