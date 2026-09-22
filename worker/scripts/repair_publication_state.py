# -*- coding: utf-8 -*-
"""
REPAIR_PUBLICATION_STATE — remet d'accord l'état « publié » d'un kill et
les portes QC de son game_event, sans rien décider à la place de l'humain.

1. kills.status='published' mais publication_status='hidden' alors que le
   kill passe TOUTES les portes aujourd'hui (clip, description ≥ 50
   caractères, kill visible). Cas typique : clip co-stream invisible
   (publication 'hidden'), puis re-clip Twitch visible. Le trigger
   fn_sync_kill_status_split ne recalcule la visibilité que quand `status`
   CHANGE — published -> published ne le déclenche pas : le kill restait
   invisible sur le site (ex. le penta de Canna, 65b4a84c).
2. game_events dont les portes « dures » ou qc_visible sont PÉRIMÉES par
   rapport au kill (clip produit depuis, description écrite depuis, kill
   devenu visible après re-clip). Au redémarrage du démon, event_publisher
   retirerait ces kills (status -> analyzed). Même dérivation que
   event_mapper._kill_to_event_row. qc_human_approved n'est JAMAIS touché :
   un blocage humain ou de dédoublonnage reste un blocage.

Usage :
  python scripts/repair_publication_state.py           # rapport seulement
  python scripts/repair_publication_state.py --apply
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv()
from services.supabase_client import get_db  # noqa: E402

MIN_DESCRIPTION_CHARS = 50          # = analyzer.MIN_DESCRIPTION_CHARS / event_mapper
REPORT_DIR = Path(r"D:\kckills_worker\repair_publication")


def fetch_all(db, table: str, params: dict) -> list[dict]:
    client, rows, offset = db._get_client(), [], 0
    while True:
        r = client.get(f"{db.base}/{table}", params={**params, "limit": "1000", "offset": str(offset)})
        r.raise_for_status()
        page = r.json() or []
        rows.extend(page)
        if len(page) < 1000:
            return rows
        offset += 1000


def passes_gates(k: dict) -> bool:
    return (bool(k.get("clip_url_vertical"))
            and len(str(k.get("ai_description") or "")) >= MIN_DESCRIPTION_CHARS
            and k.get("kill_visible") is not False
            and bool(k.get("killer_champion")) and bool(k.get("victim_champion")))


def expected_ticks(k: dict) -> dict:
    """Portes dérivées de l'état du kill (event_mapper._kill_to_event_row)."""
    return {
        "qc_clip_produced": k.get("clip_url_vertical") is not None,
        "qc_clip_validated": k.get("status") in ("analyzed", "published") and k.get("clip_url_vertical") is not None,
        "qc_typed": k.get("killer_champion") is not None and k.get("victim_champion") is not None,
        "qc_described": len(str(k.get("ai_description") or "")) >= MIN_DESCRIPTION_CHARS,
        "qc_visible": k.get("kill_visible"),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    db = get_db()
    client = db._get_client()
    kcols = "id,status,publication_status,kill_visible,ai_description,clip_url_vertical,killer_champion,victim_champion"

    # 1. publiés mais masqués alors qu'ils passent les portes
    hidden = fetch_all(db, "kills", {"select": kcols, "status": "eq.published", "publication_status": "eq.hidden"})
    unhide = [k for k in hidden if passes_gates(k)]

    # 2. événements périmés (kills publiés ou analysés)
    evs = fetch_all(db, "game_events", {
        "select": "id,kill_id,qc_clip_produced,qc_clip_validated,qc_typed,qc_described,qc_visible,"
                  "kills!inner(" + kcols + ")",
        "kills.status": "in.(published,analyzed)",
    })
    refresh: list[tuple[str, dict, dict]] = []
    why = Counter()
    for e in evs:
        want = expected_ticks(e["kills"])
        patch = {}
        for g in ("qc_clip_produced", "qc_clip_validated", "qc_typed", "qc_described"):
            if want[g] and not e.get(g):          # on ne FERME jamais une porte dure ici
                patch[g] = True
        if e.get("qc_visible") is False and want["qc_visible"] is True:
            patch["qc_visible"] = True             # kill re-clippé devenu visible
        if patch:
            refresh.append((e["kill_id"], patch, {g: e.get(g) for g in patch}))
            why[tuple(sorted(patch))] += 1

    report = {"generated": time.strftime("%Y-%m-%d %H:%M:%S"), "apply": args.apply,
              "unhide": [k["id"] for k in unhide], "hidden_total": len(hidden),
              "refresh": [{"kill_id": kid, "patch": p, "before": b} for kid, p, b in refresh],
              "refresh_by_gates": {"+".join(k): v for k, v in why.items()}}
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / f"report_{time.strftime('%Y%m%d_%H%M%S')}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"publiés masqués : {len(hidden)} dont {len(unhide)} passent les portes -> visibles")
    print(f"événements périmés : {len(refresh)} {dict(why)}")
    print("rapport :", path)
    if not args.apply:
        return
    for i in range(0, len(unhide), 80):
        chunk = [k["id"] for k in unhide[i:i + 80]]
        r = client.patch(f"{db.base}/kills", params={"id": f"in.({','.join(chunk)})"},
                         json={"publication_status": "published"},
                         headers={**db.headers, "Prefer": "return=minimal"})
        r.raise_for_status()
    done = 0
    for kid, patch, _ in refresh:
        r = client.patch(f"{db.base}/game_events", params={"kill_id": f"eq.{kid}"}, json=patch,
                         headers={**db.headers, "Prefer": "return=minimal"})
        if r.status_code < 400:
            done += 1
    print(f"appliqué : {len(unhide)} kills rendus visibles, {done}/{len(refresh)} événements rafraîchis")


if __name__ == "__main__":
    main()
