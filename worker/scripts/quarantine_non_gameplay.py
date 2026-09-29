# -*- coding: utf-8 -*-
"""
QUARANTINE_NON_GAMEPLAY — sort du feed les clips publiés dont l'image n'est
pas du jeu (draft, plateau, host, interview, facecam, graphique, pub…).

Constat du 29/09/2026 : des clips publiés, coupés au mauvais offset VOD,
montent la draft (« 5th BAN »), un joueur au bureau, une interview, le
plateau ou la facecam d'un streamer au lieu du kill. La liste des kills
vient de l'audit des vignettes (classifieur SigLIP 2 local + vérification
à l'œil + images tirées du clip lui-même), fichier JSON :

    [{"kill_id": "…", "category": "draft|desk|interview|…",
      "evidence": "texte libre, repris dans reclip_reason"}, …]

Neutralisation, JAMAIS de delete — même motif que qc_repass_published :
  kills       : status='needs_review', publication_status='hidden' (écrit
                EXPLICITEMENT : le trigger fn_sync_kill_status_split ne le
                recalcule que si status change), kill_visible=false,
                qc_status='failed', needs_reclip=true, reclip_reason.
                content_hash n'est JAMAIS dans le PATCH (piège 23505).
  game_events : qc_clip_validated=false + qc_visible=false (portes QC du
                clip) + publish_blocked_reason. qc_human_approved n'est PAS
                touché : un re-clip réussi (twitch_backfill, pipeline)
                rouvre qc_clip_validated / qc_visible tout seul, alors qu'un
                blocage humain ferait retirer le kill re-clippé par
                event_publisher.
Aucun chemin automatique ne republie un kill en needs_review : event_publisher,
og_generator et auto_fix_loop ne reprennent que status='analyzed'.

Seuls les kills ENCORE visibles dans le feed sont touchés (publication_status
'published', ou NULL + status 'published'). Chaque écriture est vérifiée
(1 ligne renvoyée) et journalisée AVANT la suivante (JSONL) : le journal
reste complet même si le script est interrompu.

Usage :
  python scripts/quarantine_non_gameplay.py candidates.json            # rapport
  python scripts/quarantine_non_gameplay.py candidates.json --apply
  python scripts/quarantine_non_gameplay.py --rollback <journal.jsonl>

Rollback : restaure les valeurs d'avant, kill par kill, SEULEMENT si le kill
est encore dans l'état écrit par la quarantaine (un kill re-clippé et
republié entre-temps n'est pas écrasé ; il est listé à part).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
from services.supabase_client import get_db  # noqa: E402

REPORT_DIR = Path(r"D:\kckills_worker\quarantine_non_gameplay")
KILL_FIELDS = ("status", "publication_status", "kill_visible", "qc_status",
               "needs_reclip", "reclip_reason")
EVENT_FIELDS = ("qc_clip_validated", "qc_visible", "publish_blocked_reason")
CHUNK = 100


def in_feed(k: dict) -> bool:
    pub = k.get("publication_status")
    return pub == "published" or (pub is None and k.get("status") == "published")


def fetch_by_ids(db, table: str, key: str, ids: list[str], select: str) -> dict[str, dict]:
    client, out = db._get_client(), {}
    for i in range(0, len(ids), CHUNK):
        chunk = ids[i:i + CHUNK]
        r = client.get(f"{db.base}/{table}",
                       params={"select": select, key: f"in.({','.join(chunk)})", "limit": str(CHUNK * 2)})
        r.raise_for_status()
        for row in r.json() or []:
            out[row[key]] = row
    return out


def patch_one(db, table: str, key: str, value: str, patch: dict) -> int:
    """PATCH vérifié : renvoie le nombre de lignes réellement modifiées
    (PostgREST répond 200 même quand RLS ou le filtre ne touchent rien)."""
    assert "content_hash" not in patch
    r = db._get_client().patch(f"{db.base}/{table}", params={key: f"eq.{value}"}, json=patch,
                               headers={**db.headers, "Prefer": "return=representation"})
    r.raise_for_status()
    return len(r.json() or [])


def quarantine_patch(c: dict) -> tuple[dict, dict]:
    reason = f"non_gameplay:{c.get('category') or '?'} {c.get('evidence') or ''}".strip()[:240]
    kill_patch = {"status": "needs_review", "publication_status": "hidden", "kill_visible": False,
                  "qc_status": "failed", "needs_reclip": True, "reclip_reason": reason}
    event_patch = {"qc_clip_validated": False, "qc_visible": False,
                   "publish_blocked_reason": reason[:500]}
    return kill_patch, event_patch


def run(candidates_path: Path, apply: bool) -> None:
    db = get_db()
    cands = json.loads(candidates_path.read_text(encoding="utf-8"))
    by_id = {c["kill_id"]: c for c in cands}
    ids = list(by_id)
    kills = fetch_by_ids(db, "kills", "id", ids, "id," + ",".join(KILL_FIELDS))
    events = fetch_by_ids(db, "game_events", "kill_id", ids, "id,kill_id," + ",".join(EVENT_FIELDS))
    todo = [kid for kid in ids if kid in kills and in_feed(kills[kid])]
    skipped = {kid: ("introuvable" if kid not in kills else
                     f"déjà hors feed ({kills[kid].get('status')}/{kills[kid].get('publication_status')})")
               for kid in ids if kid not in todo}

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    journal = REPORT_DIR / f"journal_{stamp}{'' if apply else '_dryrun'}.jsonl"
    print(f"candidats : {len(ids)} | encore dans le feed : {len(todo)} | ignorés : {len(skipped)}")
    print("journal :", journal)
    done = 0
    with journal.open("w", encoding="utf-8") as jf:
        jf.write(json.dumps({"type": "header", "generated": stamp, "apply": apply,
                             "candidates": str(candidates_path), "n_candidates": len(ids),
                             "n_todo": len(todo), "skipped": skipped}, ensure_ascii=False) + "\n")
        for kid in todo:
            kp, ep = quarantine_patch(by_id[kid])
            before_k = {f: kills[kid].get(f) for f in KILL_FIELDS}
            ev = events.get(kid)
            before_e = {f: ev.get(f) for f in EVENT_FIELDS} if ev else None
            entry = {"type": "kill", "kill_id": kid, "category": by_id[kid].get("category"),
                     "before_kill": before_k, "after_kill": kp,
                     "event_id": ev.get("id") if ev else None, "before_event": before_e,
                     "after_event": ep if ev else None, "applied": False}
            if apply:
                n = patch_one(db, "kills", "id", kid, kp)
                ne = patch_one(db, "game_events", "kill_id", kid, ep) if ev else 0
                entry.update(applied=n == 1, kill_rows=n, event_rows=ne,
                             at=time.strftime("%Y-%m-%dT%H:%M:%S"))
                done += int(n == 1)
            jf.write(json.dumps(entry, ensure_ascii=False) + "\n")
            jf.flush()
    if apply:
        print(f"mis en quarantaine : {done}/{len(todo)}")
    else:
        print("rapport seulement — relancer avec --apply")


def rollback(journal_path: Path) -> None:
    db = get_db()
    entries = [json.loads(l) for l in journal_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    entries = [e for e in entries if e.get("type") == "kill" and e.get("applied")]
    ids = [e["kill_id"] for e in entries]
    now = fetch_by_ids(db, "kills", "id", ids, "id," + ",".join(KILL_FIELDS))
    restored, changed = 0, []
    for e in entries:
        cur = now.get(e["kill_id"]) or {}
        # Le kill a bougé depuis la quarantaine (re-clip, revue…) : on n'écrase pas.
        if any(cur.get(f) != v for f, v in e["after_kill"].items()):
            changed.append(e["kill_id"])
            continue
        n = patch_one(db, "kills", "id", e["kill_id"], e["before_kill"])
        if e.get("before_event"):
            patch_one(db, "game_events", "kill_id", e["kill_id"], e["before_event"])
        restored += int(n == 1)
    print(f"restaurés : {restored}/{len(entries)} | modifiés depuis (non touchés) : {len(changed)}")
    if changed:
        print("  ", ", ".join(k[:8] for k in changed[:50]))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("candidates", nargs="?", help="JSON [{kill_id, category, evidence}]")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--rollback", default=None, help="journal JSONL d'un --apply")
    args = ap.parse_args()
    if args.rollback:
        rollback(Path(args.rollback))
    elif args.candidates:
        run(Path(args.candidates), args.apply)
    else:
        ap.error("candidates.json ou --rollback requis")


if __name__ == "__main__":
    main()
