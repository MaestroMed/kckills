"""QC re-pass sur TOUT le stock publié (demande Mehdi 2026-07-23).

« encore beaucoup de clips mal faits ou mal timés ou c'est pas du jeu,
c'est de l'after-show ou de l'inter-match. »

Pour chaque kill publié (team_killer + visible) : télécharge le clip depuis
R2 (egress gratuit), passe la batterie clip_qc_v2.run_qc — sanité média,
frame noire/gel, timer multi-frames (OCR calibré d'abord, Gemini ≤2 lectures
en secours, chaque succès entraîne l'OCR), is_gameplay par vision.

Verdict FAIL (bloquant) → le clip disparaît du site immédiatement :
    kill_visible=false + status='needs_review' + needs_reclip=true
    + reclip_reason=<checks en échec>          (JAMAIS de delete)
→ le pipeline de reclip (offset corrigé) peut ensuite les refaire.

Idempotent + checkpoint (qc_repass_state.json) : Ctrl-C et reprise sûres.

Usage :
  python scripts/qc_repass_published.py --limit 25          # validation
  python scripts/qc_repass_published.py                     # full run
  python scripts/qc_repass_published.py --reset             # ignore checkpoint
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

import httpx

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))
from dotenv import load_dotenv
load_dotenv(_ROOT / ".env")

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.supabase_client import get_db  # noqa: E402
from modules.clip_qc_v2 import run_qc, ProbeBudget  # noqa: E402

STATE = _ROOT / "qc_repass_state.json"
DBREF: dict = {}
PAGE = 200
BEFORE_PAD = 30   # pad standard du clipper : le kill est à ~30 s du début


def load_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except Exception:
        return {"done_ids": [], "failed": 0, "passed": 0}


def save_state(st: dict) -> None:
    STATE.write_text(json.dumps(st))


async def qc_one(k: dict, tmpdir: str) -> tuple[bool, str]:
    """Retourne (ok, detail). ok=False → à masquer."""
    url = k.get("clip_url_horizontal") or k.get("clip_url_vertical")
    if not url:
        return False, "no_clip_url"
    local = os.path.join(tmpdir, f"{k['id']}.mp4")
    try:
        with httpx.stream("GET", url, timeout=120, follow_redirects=True) as r:
            if r.status_code != 200:
                return False, f"clip_http_{r.status_code}"
            with open(local, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
        gt = int(k.get("game_time_seconds") or 0)
        expected = {15: gt - BEFORE_PAD + 15, 32: gt - BEFORE_PAD + 32}
        res = await run_qc(
            local,
            expected_timer_at=expected,
            killer_champion=k.get("killer_champion"),
            victim_champion=k.get("victim_champion"),
            budget=ProbeBudget(2),
        )
        failed = [c.name for c in res.checks
                  if c.blocking and c.verdict == "fail"]
        drift = getattr(res, "drift_measured", None)
        # Règle d'ÉJECTION (visibilité site) — plus tolérante que le QC
        # pipeline : on ne cache que l'invisible/inregardable.
        #   * pas du jeu (aftershow/draft/desk)      -> eject
        #   * média cassé (durée/muet/gelé/noir)     -> eject
        #   * timer illisible ET vision muette        -> eject (prudence)
        #   * drift > 35 s (kill hors cadre, pad 30) -> eject
        #   * drift <= 35 s : le kill est encore dans le cadre -> ON GARDE
        #     visible, mais needs_reclip pour la refonte offset.
        # ⚠️ RÈGLE DE PREUVE POSITIVE (incident 2026-07-23) : la v1 éjectait
        # sur ABSENCE de preuve — quand l'OCR n'était pas calibré pour un
        # overlay ET que Gemini était à court de quota, timer_matches et
        # start_is_gameplay tombaient tous les deux en "fail" faute d'avoir
        # RIEN pu lire (drift=None) → 3 580 clips masqués sur 3 887 (92 %),
        # site vidé. On n'éjecte plus que sur ce que l'outillage a
        # RÉELLEMENT VU :
        #   * checks média (ffprobe LOCAL, jamais aveugle) → confiance totale
        #   * drift mesuré (drift is not None) et > 35 s → kill hors cadre
        #   * is_gameplay=false EXPLICITE de la vision (pas "vision muette")
        # Un outillage aveugle laisse le clip en ligne et demande un reclip.
        MEDIA = {"duration_sane", "audio_present", "start_not_frozen"}
        vision_saw = getattr(res, "vision_result", None) is not None
        eject = (
            any(c in MEDIA for c in failed)
            or ("timer_matches" in failed and drift is not None and abs(drift) > 35)
            or ("start_is_gameplay" in failed and vision_saw)
        )
        soft_reclip = bool(failed) and not eject
        if soft_reclip:
            httpx.patch(f"{DBREF['db'].base}/kills",
                        headers={**DBREF['db'].headers, "Prefer": "return=minimal"},
                        params={"id": f"eq.{k['id']}"},
                        json={"needs_reclip": True,
                              "reclip_reason": f"qc_soft: {','.join(failed)[:80]} drift={drift}"},
                        timeout=30)
        detail = f"{','.join(failed) or 'pass'} drift={drift}"
        return (not eject), detail
    except Exception as e:
        # Erreur d'infra (réseau/ffmpeg) ≠ mauvais clip : on passe, on
        # ne masque JAMAIS sur un échec d'outillage.
        return True, f"tool_error:{str(e)[:60]}"
    finally:
        try:
            os.remove(local)
        except OSError:
            pass


def apply_fail(db, kill_id: str, detail: str) -> None:
    httpx.patch(
        f"{db.base}/kills",
        headers={**db.headers, "Prefer": "return=minimal"},
        params={"id": f"eq.{kill_id}"},
        json={
            "kill_visible": False,
            "status": "needs_review",
            "needs_reclip": True,
            "reclip_reason": f"qc_repass: {detail[:120]}",
        },
        timeout=30,
    )


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--reset", action="store_true")
    args = ap.parse_args()

    st = {"done_ids": [], "failed": 0, "passed": 0} if args.reset else load_state()
    done = set(st["done_ids"])
    db = get_db()
    DBREF['db'] = db

    rows: list[dict] = []
    offset = 0
    while True:
        r = httpx.get(f"{db.base}/kills", headers=db.headers, params={
            "select": "id,clip_url_horizontal,clip_url_vertical,"
                      "game_time_seconds,killer_champion,victim_champion",
            "status": "eq.published",
            "tracked_team_involvement": "eq.team_killer",
            "kill_visible": "not.is.false",
            "order": "id",
            "offset": str(offset), "limit": str(PAGE),
        }, timeout=30)
        batch = r.json()
        if not isinstance(batch, list) or not batch:
            break
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        offset += PAGE

    todo = [k for k in rows if k["id"] not in done]
    if args.limit:
        todo = todo[: args.limit]
    print(f"publiés visibles: {len(rows)} | déjà passés: {len(done)} | à traiter: {len(todo)}")

    tmpdir = tempfile.mkdtemp(prefix="qc_repass_")
    n_fail = 0
    for i, k in enumerate(todo):
        ok, detail = await qc_one(k, tmpdir)
        if not ok:
            apply_fail(db, k["id"], detail)
            st["failed"] += 1
            n_fail += 1
            print(f"  ✗ {k['id'][:8]} {k.get('killer_champion','?'):12s} -> {detail}")
        else:
            st["passed"] += 1
        st["done_ids"].append(k["id"])
        if (i + 1) % 10 == 0:
            save_state(st)
            print(f"[{i+1}/{len(todo)}] fails cumulés ce run: {n_fail}")
    save_state(st)
    print(f"\nTERMINÉ — passés: {st['passed']} | masqués: {st['failed']}")


if __name__ == "__main__":
    asyncio.run(main())
