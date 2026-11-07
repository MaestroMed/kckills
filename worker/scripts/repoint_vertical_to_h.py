"""
REPOINT_VERTICAL_TO_H — régime R2 du 07/11/2026.

Le v.mp4 (9:16 HQ) n'est qu'un recadrage du h.mp4 (16:9) décalé de 8 % à
droite. Le site recadre désormais h.mp4 en direct (object-fit cover,
object-position 62 % 50 %, script global de web/src/app/layout.tsx).
Ce script fait pointer toutes les URLs « vertical » sur le h.mp4 :

  - kills.clip_url_vertical       := kills.clip_url_horizontal
  - moments.clip_url_vertical     := moments.clip_url_horizontal
  - kill_assets (type=vertical, is_current) url/r2_key := ceux du horizontal

clip_url_vertical n'est PAS mis à NULL : une vingtaine de requêtes et de
RPC filtrent sur clip_url_vertical IS NOT NULL.

Une fois appliqué, plus rien ne référence les v.mp4 sur R2 : ils peuvent
être supprimés (~248 Go), après accord de Mehdi.

  python scripts/repoint_vertical_to_h.py                 # dry-run
  python scripts/repoint_vertical_to_h.py --apply         # écrit + journal
  python scripts/repoint_vertical_to_h.py --rollback logs/repoint_vertical_<ts>.jsonl

Journal : logs/repoint_vertical_<ts>.jsonl, une ligne par écriture avec
l'ancienne valeur. Idempotent : une 2e passe ne trouve plus rien.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path.cwd() / ".env")
URL = os.environ["SUPABASE_URL"]
KEY = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
PAGE = 1000
CONC = 12


def fetch_all(c: httpx.Client, table: str, params: dict) -> list[dict]:
    out: list[dict] = []
    off = 0
    while True:
        r = c.get(f"{URL}/rest/v1/{table}", headers=H,
                  params={**params, "order": "id", "limit": PAGE, "offset": off})
        r.raise_for_status()
        rows = r.json()
        out += rows
        if len(rows) < PAGE:
            return out
        off += PAGE


def plan(c: httpx.Client) -> list[dict]:
    """Liste des écritures : {table, id, new: {...}, old: {...}}."""
    ops: list[dict] = []
    for table in ("kills", "moments"):
        rows = fetch_all(c, table, {
            "select": "id,clip_url_horizontal,clip_url_vertical",
            "clip_url_vertical": "not.is.null",
            "clip_url_horizontal": "not.is.null",
        })
        for r in rows:
            if r["clip_url_vertical"] != r["clip_url_horizontal"]:
                ops.append({"table": table, "id": r["id"],
                            "old": {"clip_url_vertical": r["clip_url_vertical"]},
                            "new": {"clip_url_vertical": r["clip_url_horizontal"]}})
    sel = "id,kill_id,type,url,r2_key"
    hz = {a["kill_id"]: a for a in fetch_all(c, "kill_assets", {
        "select": sel, "type": "eq.horizontal", "is_current": "eq.true"})}
    vt = fetch_all(c, "kill_assets", {
        "select": sel, "type": "eq.vertical", "is_current": "eq.true"})
    orphan = 0
    for a in vt:
        h = hz.get(a["kill_id"])
        if not h:
            orphan += 1
            continue
        if a["url"] != h["url"] or a.get("r2_key") != h.get("r2_key"):
            ops.append({"table": "kill_assets", "id": a["id"],
                        "old": {"url": a["url"], "r2_key": a.get("r2_key")},
                        "new": {"url": h["url"], "r2_key": h.get("r2_key")}})
    print(f"kill_assets vertical sans horizontal courant : {orphan} (laissés tels quels)")
    return ops


async def run(ops: list[dict], key: str, journal: Path | None) -> int:
    sem = asyncio.Semaphore(CONC)
    fails = 0
    jf = journal.open("a", encoding="utf-8") if journal else None
    async with httpx.AsyncClient(timeout=30) as ac:
        async def one(op: dict) -> None:
            nonlocal fails
            async with sem:
                for attempt in range(4):
                    try:
                        r = await ac.patch(f"{URL}/rest/v1/{op['table']}", headers=H,
                                           params={"id": f"eq.{op['id']}"}, json=op[key])
                        r.raise_for_status()
                        if jf:
                            jf.write(json.dumps(op) + "\n")
                        return
                    except Exception as e:  # noqa: BLE001
                        if attempt == 3:
                            fails += 1
                            print("ÉCHEC", op["table"], op["id"], str(e)[:120])
                        await asyncio.sleep(2 ** attempt)
        await asyncio.gather(*(one(o) for o in ops))
    if jf:
        jf.close()
    return fails


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--rollback")
    a = ap.parse_args()
    if a.rollback:
        ops = [json.loads(l) for l in Path(a.rollback).read_text(encoding="utf-8").splitlines() if l]
        print(f"rollback : {len(ops)} écritures")
        fails = asyncio.run(run(ops, "old", None))
        print(f"fini, échecs : {fails}")
        return
    with httpx.Client(timeout=60) as c:
        ops = plan(c)
    by = {}
    for o in ops:
        by[o["table"]] = by.get(o["table"], 0) + 1
    print("à écrire :", by or "rien")
    for o in ops[:3]:
        print("  ex.", o["table"], o["old"], "->", o["new"])
    if not a.apply or not ops:
        print("dry-run" if not a.apply else "rien à faire")
        return
    logs = Path.cwd() / "logs"
    logs.mkdir(exist_ok=True)
    journal = logs / f"repoint_vertical_{time.strftime('%Y%m%d_%H%M%S')}.jsonl"
    fails = asyncio.run(run(ops, "new", journal))
    print(f"fini, journal {journal}, échecs : {fails}")


if __name__ == "__main__":
    main()
