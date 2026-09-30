"""
REPUBLISH_RECLIPPED — remet en ligne les kills masqués dont le re-clip est validé.

Contexte (30/09/2026) : les kills des games recalées (VOD partagée au même
offset) sont re-clippés par reclip_from_ledger. Ceux qui avaient été masqués
avant (quarantaine « sans jeu » du 29/09, qc_media_fail_confirmed…) reçoivent un
bon clip mais restent masqués : reclip_from_ledger ne touche pas au statut.
Décision de Mehdi : les remettre en ligne une fois corrigés.

Un kill n'est republié que si :
  * son entrée clip_ledger dit reclip_done=true et qc_verdict='pass' ;
  * il est aujourd'hui hors feed (status needs_review, publication hidden/NULL) ;
  * son game_event a déjà les autres portes vertes (qc_clip_produced, qc_typed,
    qc_described) et n'est pas refusé à la main (qc_human_approved IS NOT FALSE).

Ordre des écritures (sinon le démon retire le kill, is_publishable=FALSE) :
  1. game_events : qc_clip_validated=true, qc_visible=true, publish_blocked_reason=NULL
  2. relecture : is_publishable doit être TRUE, sinon on n'écrit rien sur le kill
  3. kills : status + publication_status 'published' (ensemble : le trigger ne
     recalcule la visibilité que si status change), kill_visible=true,
     qc_status='passed', needs_reclip=false

Usage :
    python scripts/republish_reclipped.py --games-file <liste>          # dry-run
    python scripts/republish_reclipped.py --games-file <liste> --apply
Journal : D:\\kckills_worker\\republish_reclipped_<horodatage>.json (avant/après)
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
U = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/"
K = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": K, "Authorization": f"Bearer {K}", "Content-Type": "application/json"}

KILL_FIELDS = "id,game_id,status,publication_status,kill_visible,qc_status,needs_reclip,reclip_reason"
EVENT_FIELDS = ("id,kill_id,qc_clip_produced,qc_clip_validated,qc_typed,qc_described,qc_visible,"
                "qc_human_approved,publish_blocked_reason,is_publishable,published_at")


def _get_all(table: str, params: dict) -> list[dict]:
    rows, off = [], 0
    while True:
        b = httpx.get(U + table, headers={**H, "Range": f"{off}-{off + 999}"}, params=params, timeout=60).json()
        rows += b
        if len(b) < 1000:
            return rows
        off += 1000


def _by_ids(table: str, col: str, ids: list[str], select: str) -> list[dict]:
    out = []
    for i in range(0, len(ids), 60):
        out += _get_all(table, {"select": select, col: f"in.({','.join(ids[i:i + 60])})"})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--games-file", required=True)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    games = {l.strip() for l in open(args.games_file, encoding="utf-8") if l.strip()}

    ledger = [e for e in _get_all("clip_ledger", {
        "select": "kill_id,game_id,qc_verdict,asset_check", "asset_check->>reclip_done": "eq.true",
        "qc_verdict": "eq.pass"}) if e["game_id"] in games]
    kills = {k["id"]: k for k in _by_ids("kills", "id", [e["kill_id"] for e in ledger], KILL_FIELDS)}
    hidden = [k for k in kills.values()
              if k["status"] == "needs_review" and k.get("publication_status") in ("hidden", None)]
    events = {e["kill_id"]: e for e in _by_ids("game_events", "kill_id", [k["id"] for k in hidden], EVENT_FIELDS)}

    todo, skipped = [], {}
    for k in hidden:
        ev = events.get(k["id"])
        why = None
        if ev is None:
            why = "pas de game_event"
        elif not (ev.get("qc_clip_produced") and ev.get("qc_typed") and ev.get("qc_described")):
            why = "autre porte fermée (produit/typé/décrit)"
        elif ev.get("qc_human_approved") is False:
            why = "refusé à la main"
        if why:
            skipped[why] = skipped.get(why, 0) + 1
        else:
            todo.append((k, ev))
    print(f"re-clips validés dans ces games : {len(ledger)} | masqués : {len(hidden)} | "
          f"à republier : {len(todo)} | ignorés : {skipped}")
    if not args.apply:
        return

    journal = {"generated": datetime.now(timezone.utc).isoformat(), "rows": []}
    ok = 0
    for k, ev in todo:
        ev_patch = {"qc_clip_validated": True, "qc_visible": True, "publish_blocked_reason": None}
        httpx.patch(U + "game_events", headers=H, params={"id": f"eq.{ev['id']}"}, json=ev_patch, timeout=30).raise_for_status()
        after = httpx.get(U + "game_events", headers=H, params={"select": "is_publishable", "id": f"eq.{ev['id']}"}, timeout=30).json()
        row = {"kill_id": k["id"], "event_id": ev["id"],
               "before_kill": {f: k.get(f) for f in KILL_FIELDS.split(",")[2:]},
               "before_event": {f: ev.get(f) for f in ("qc_clip_validated", "qc_visible", "publish_blocked_reason")}}
        if not (after and after[0].get("is_publishable")):
            row["result"] = "event_non_publiable"   # portes rouvertes, kill laissé masqué
            journal["rows"].append(row)
            continue
        kill_patch = {"status": "published", "publication_status": "published", "kill_visible": True,
                      "qc_status": "passed", "needs_reclip": False}
        httpx.patch(U + "kills", headers=H, params={"id": f"eq.{k['id']}"}, json=kill_patch, timeout=30).raise_for_status()
        row["result"] = "republie"
        journal["rows"].append(row)
        ok += 1
    path = os.path.join(r"D:\kckills_worker", f"republish_reclipped_{datetime.now():%Y%m%d_%H%M%S}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(journal, f, ensure_ascii=False, indent=1)
    print(f"republiés : {ok} / {len(todo)} | journal : {path}")


if __name__ == "__main__":
    main()
