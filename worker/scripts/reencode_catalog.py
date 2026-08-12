# -*- coding: utf-8 -*-
"""
REENCODE_CATALOG — Ré-encode le stock publié aux réglages actuels du clipper.

CONSTAT (mesure 2026-08-12) : les clips publiés du catalogue font ~20,4 Mo
en 720/1080p (~4,07 Mb/s sur 40 s) alors que le clipper encode depuis le
03/08/2026 en 30 fps / crf 25 / maxrate 2,5M (voir services/ffmpeg_ops.py,
note VMAF dans video_codec_args). Le stock ancien n'a jamais été ré-encodé.

Ce script :
  1. SCAN     — kills publiés dont l'asset courant v/h dépasse un seuil de
                débit (défaut 3,0 Mb/s ; mesuré via kill_assets.size_bytes /
                duration_ms, fallback HEAD content-length sur R2).
  2. DRY-RUN  — (défaut) rapport : nb de clips, Go actuels, Go estimés
                après ré-encodage, heures NVENC estimées. AUCUNE écriture.
  3. APPLY    — par kill : download h+v depuis R2 → ré-encode h / v / v_low
                aux réglages du clipper (fps=30 + video_codec_args, movflags
                +faststart) → upload vers un NOUVEAU chemin versionné
                clips/{game}/{kill}/v{N+1}/ (JAMAIS d'écrasement — pattern
                v1 → v2 du manifest, cf. migration 026 + clip_ledger 088)
                → archive les kill_assets v/h/v_low courants → insert des
                rows v{N+1} (le trigger fn_refresh_kill_assets_manifest
                reconstruit assets_manifest) → PATCH kills des URLs
                SEULEMENT (jamais content_hash — piège 23505).
                Les anciens objets R2 restent en place (GC référence-based :
                scripts/gc_r2_orphans.py les ramassera une fois orphelins).

RESUMABLE : état JSON dans worker/reencode_catalog_state.json, écrit après
chaque kill. Un run interrompu reprend où il s'était arrêté ; les kills en
échec sont retentés au run suivant (sauf --no-retry-failed).

Respect du scheduler existant : ffmpeg_cooldown avant chaque encode,
délai "r2" via r2_client.upload. Aucune dépendance Gemini/YouTube.

Usage (depuis worker/) :
    .venv\\Scripts\\python.exe scripts/reencode_catalog.py                # dry-run complet
    .venv\\Scripts\\python.exe scripts/reencode_catalog.py --limit 5      # dry-run 5 clips
    .venv\\Scripts\\python.exe scripts/reencode_catalog.py --apply --limit 20
    .venv\\Scripts\\python.exe scripts/reencode_catalog.py --apply        # tout le stock
    ... --min-mbps 3.0        seuil de sélection (débit mesuré du v ou h)
    ... --hls                 (opt-in) re-packager le HLS depuis le nouveau
                              v.mp4 après chaque ré-encodage réussi
                              (modules/hls_packager.package_clip). À ne faire
                              qu'une fois le fix GC déployé (hls/ protégé
                              dans gc_r2_unlisted.py) ET quand le front
                              re-sert le HLS — sinon on re-brûle des writes
                              R2 pour rien (cf. gate Wave 44).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import httpx  # noqa: E402
import structlog  # noqa: E402

structlog.configure(processors=[
    structlog.processors.TimeStamper(fmt="iso"),
    structlog.processors.add_log_level,
    structlog.dev.ConsoleRenderer(),
])
log = structlog.get_logger()

from config import config  # noqa: E402
from scheduler import scheduler  # noqa: E402
from services import r2_client  # noqa: E402
from services.clip_hash import content_hash  # noqa: E402
from services.ffmpeg_ops import video_codec_args, has_nvenc  # noqa: E402
from services.media_probe import probe_video  # noqa: E402
from services.supabase_client import get_db, safe_update  # noqa: E402

STATE_FILE = Path(__file__).resolve().parent.parent / "reencode_catalog_state.json"

# Miroir de modules/clipper.py CLIP_FPS (03/08/2026) — pas d'import du
# clipper entier ici (il tire Pillow / job_queue / overlays au module-load).
CLIP_FPS = 30

# Types remplacés par ce script. Le thumbnail et l'og_image ne sont PAS
# touchés (pas de ré-encodage vidéo → on ne doit pas les archiver, sinon
# le manifest perdrait leur entrée).
REPLACED_TYPES = ("horizontal", "vertical", "vertical_low")

URL_KEY_BY_TYPE = {
    "horizontal": "clip_url_horizontal",
    "vertical": "clip_url_vertical",
    "vertical_low": "clip_url_vertical_low",
}

# ─── Estimations dry-run ──────────────────────────────────────────────
# Débits cibles observés aux réglages actuels (note VMAF ffmpeg_ops.py :
# crf 25 / max 2,5M ≈ 2,27 Mb/s effectifs sur un clip réel ; v_low 540p
# ≈ 1,0 Mb/s). Durée par défaut = CLIP_TIMING total (40 s).
TARGET_MBPS_HQ = 2.3
TARGET_MBPS_LOW = 1.0
DEFAULT_DURATION_S = 40.0
# NVENC RTX 4070 Ti ≈ 8x temps réel par encode 1080p (mesure hls_packager :
# 4,71 s pour 40 s) ; 3 encodes + download/upload ≈ 30 s mur par clip.
EST_SECONDS_PER_CLIP_NVENC = 30.0
EST_SECONDS_PER_CLIP_X264 = 120.0

FFMPEG_TIMEOUT_S = 300
DOWNLOAD_TIMEOUT_S = 120


# ─── État résumable ───────────────────────────────────────────────────

def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception as e:
            log.warn("state_load_failed", error=str(e)[:120])
    return {"version": 1, "done": {}}


def save_state(state: dict) -> None:
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    tmp = STATE_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=1), encoding="utf-8")
    tmp.replace(STATE_FILE)


# ─── Fetch helpers ────────────────────────────────────────────────────

def fetch_page(db, table: str, params: dict, offset: int, limit: int = 1000) -> list[dict]:
    client = db._get_client()
    r = client.get(f"{db.base}/{table}",
                   params={**params, "limit": str(limit), "offset": str(offset)})
    r.raise_for_status()
    return r.json() or []


def fetch_current_assets(db, kill_ids: list[str]) -> dict[str, dict[str, dict]]:
    """→ {kill_id: {type: asset_row}} pour les types vidéo courants."""
    out: dict[str, dict[str, dict]] = {}
    client = db._get_client()
    for i in range(0, len(kill_ids), 60):
        chunk = kill_ids[i:i + 60]
        r = client.get(f"{db.base}/kill_assets", params={
            "select": "kill_id,type,version,url,r2_key,size_bytes,duration_ms,bitrate_kbps",
            "kill_id": f"in.({','.join(chunk)})",
            "is_current": "eq.true",
            "type": "in.(horizontal,vertical,vertical_low)",
            "limit": "1000",
        })
        r.raise_for_status()
        for row in (r.json() or []):
            out.setdefault(row["kill_id"], {})[row["type"]] = row
    return out


def head_size(url: str) -> int | None:
    """Content-Length via HEAD (lecture seule, R2 Class-B gratuit)."""
    try:
        r = httpx.head(url, timeout=15, follow_redirects=True)
        if r.status_code == 200:
            cl = r.headers.get("content-length")
            return int(cl) if cl else None
    except Exception:
        pass
    return None


# ─── Mesure du débit ──────────────────────────────────────────────────

def measure_kill(kill: dict, assets: dict[str, dict]) -> dict:
    """→ {mbps, duration_s, current_bytes, missing_meta} pour un kill.

    mbps = max des débits mesurés v / h (le pire format décide).
    Fallbacks : bitrate_kbps du probe → size/duration → HEAD + 40 s.
    """
    duration_s = None
    for t in ("vertical", "horizontal"):
        a = assets.get(t) or {}
        if a.get("duration_ms"):
            duration_s = a["duration_ms"] / 1000.0
            break

    mbps = 0.0
    current_bytes = 0
    missing_meta = False
    for t in ("vertical", "horizontal", "vertical_low"):
        a = assets.get(t) or {}
        size = a.get("size_bytes")
        if not size:
            url = a.get("url") or kill.get(URL_KEY_BY_TYPE[t])
            if url:
                size = head_size(url)
                missing_meta = True
        if not size:
            continue
        current_bytes += size
        if t == "vertical_low":
            continue  # le low ne décide pas de la sélection
        dur = (a.get("duration_ms") or 0) / 1000.0 or duration_s or DEFAULT_DURATION_S
        kbps = a.get("bitrate_kbps") or (size * 8 / 1000.0 / dur)
        mbps = max(mbps, kbps / 1000.0)

    return {
        "mbps": round(mbps, 2),
        "duration_s": duration_s or DEFAULT_DURATION_S,
        "current_bytes": current_bytes,
        "missing_meta": missing_meta,
    }


def estimate_new_bytes(duration_s: float) -> int:
    return int(duration_s * (TARGET_MBPS_HQ * 2 + TARGET_MBPS_LOW) * 1_000_000 / 8)


# ─── ffmpeg ───────────────────────────────────────────────────────────

async def _ffmpeg(args: list[str]) -> bool:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=FFMPEG_TIMEOUT_S)
    except asyncio.TimeoutError:
        proc.kill()
        log.error("ffmpeg_timeout")
        return False
    if proc.returncode != 0:
        err = (stderr or b"").decode("utf-8", "ignore")
        log.error("ffmpeg_failed", stderr_tail=err[-400:])
        return False
    return True


async def download(url: str, dest: str) -> bool:
    try:
        with httpx.stream("GET", url, follow_redirects=True,
                          timeout=DOWNLOAD_TIMEOUT_S) as r:
            r.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
        return os.path.getsize(dest) > 0
    except Exception as e:
        log.error("download_failed", url=url[-60:], error=str(e)[:160])
        return False


# ─── kill_assets versioning (miroir local de modules/clipper.py) ─────

def next_version(db, kill_id: str) -> int:
    try:
        r = db._get_client().get(f"{db.base}/kill_assets", params={
            "select": "version", "kill_id": f"eq.{kill_id}",
            "order": "version.desc", "limit": "1",
        })
        r.raise_for_status()
        rows = r.json() or []
        cur = int(rows[0]["version"]) if rows else 0
        return cur + 1 if cur > 0 else 1
    except Exception as e:
        log.warn("next_version_failed", kill_id=kill_id[:8], error=str(e)[:120])
        return 1


def archive_replaced_types(db, kill_id: str) -> bool:
    """is_current=false sur les SEULS types remplacés (h/v/v_low) — le
    thumbnail reste courant, contrairement à clipper._archive_prior_assets."""
    try:
        r = db._get_client().patch(
            f"{db.base}/kill_assets",
            headers={**db.headers, "Prefer": "return=minimal"},
            params={
                "kill_id": f"eq.{kill_id}",
                "is_current": "eq.true",
                "type": f"in.({','.join(REPLACED_TYPES)})",
            },
            json={"is_current": False,
                  "archived_at": datetime.now(timezone.utc).isoformat()},
        )
        return r.status_code < 400
    except Exception as e:
        log.error("archive_failed", kill_id=kill_id[:8], error=str(e)[:160])
        return False


def insert_asset_row(db, row: dict) -> bool:
    try:
        r = db._get_client().post(
            f"{db.base}/kill_assets",
            headers={**db.headers, "Prefer": "return=minimal"},
            json={k: v for k, v in row.items() if v is not None},
        )
        return r.status_code < 400
    except Exception as e:
        log.error("asset_insert_failed", kill_id=row.get("kill_id", "")[:8],
                  error=str(e)[:160])
        return False


# ─── Ré-encodage d'un kill ────────────────────────────────────────────

async def reencode_one(db, kill: dict, assets: dict[str, dict],
                       work_root: str, want_hls: bool) -> dict:
    """→ {"outcome": "ok|kept_old|failed|skipped_no_game", ...}"""
    kill_id = kill["id"]
    game_id = kill.get("game_id")
    if not game_id:
        # upload_versioned exige game_id (layout clips/{game}/{kill}/vN/).
        return {"outcome": "skipped_no_game"}

    h_url = (assets.get("horizontal") or {}).get("url") or kill.get("clip_url_horizontal")
    v_url = (assets.get("vertical") or {}).get("url") or kill.get("clip_url_vertical")
    if not v_url or not h_url:
        return {"outcome": "failed", "reason": "missing_source_url"}

    work = os.path.join(work_root, kill_id)
    os.makedirs(work, exist_ok=True)
    src_h = os.path.join(work, "src_h.mp4")
    src_v = os.path.join(work, "src_v.mp4")
    out_h = os.path.join(work, "h.mp4")
    out_v = os.path.join(work, "v.mp4")
    out_vl = os.path.join(work, "v_low.mp4")

    try:
        if not await download(h_url, src_h) or not await download(v_url, src_v):
            return {"outcome": "failed", "reason": "download"}
        old_bytes = os.path.getsize(src_h) + os.path.getsize(src_v)

        # Ré-encodage FORMAT PAR FORMAT depuis sa propre source : le v.mp4
        # publié porte déjà le smart-crop + overlays champions — re-cropper
        # depuis le h les perdrait. fps=30 + video_codec_args = mêmes
        # réglages que modules/clipper.py (03/08/2026). Audio en copy (déjà
        # AAC loudnormé au clip initial — pas de 2e génération lossy).
        await scheduler.wait_for("ffmpeg_cooldown")
        if not await _ffmpeg(["-i", src_h, "-vf", f"fps={CLIP_FPS}",
                              *video_codec_args("hq"),
                              "-c:a", "copy", "-movflags", "+faststart",
                              "-y", out_h]):
            return {"outcome": "failed", "reason": "encode_h"}

        await scheduler.wait_for("ffmpeg_cooldown")
        if not await _ffmpeg(["-i", src_v, "-vf", f"fps={CLIP_FPS}",
                              *video_codec_args("hq"),
                              "-c:a", "copy", "-movflags", "+faststart",
                              "-y", out_v]):
            return {"outcome": "failed", "reason": "encode_v"}

        # v_low re-dérivé du v publié (déjà croppé 9:16) : scale seul.
        await scheduler.wait_for("ffmpeg_cooldown")
        if not await _ffmpeg(["-i", src_v, "-vf", f"fps={CLIP_FPS},scale=540:960",
                              *video_codec_args("low"),
                              "-c:a", "aac", "-b:a", "80k",
                              "-movflags", "+faststart",
                              "-y", out_vl]):
            return {"outcome": "failed", "reason": "encode_vl"}

        new_bytes = os.path.getsize(out_h) + os.path.getsize(out_v)
        if new_bytes >= old_bytes * 0.95:
            # Gain < 5 % : pas la peine de doubler le stockage R2 pour ça.
            return {"outcome": "kept_old", "old_bytes": old_bytes,
                    "new_bytes": new_bytes}

        # ── Upload versionné (jamais d'écrasement de l'ancien objet) ──
        version = next_version(db, kill_id)
        uploads: dict[str, str | None] = {}
        for asset_type, path in (("horizontal", out_h), ("vertical", out_v),
                                 ("vertical_low", out_vl)):
            uploads[asset_type] = await r2_client.upload_versioned(
                game_id, kill_id, version, path, asset_type)
        if not uploads["horizontal"] or not uploads["vertical"]:
            # Upload incomplet → AUCUNE écriture DB, les URLs servies
            # restent les anciennes. Retenté au prochain run.
            return {"outcome": "failed", "reason": "upload"}

        # ── DB : archive → insert vN → PATCH kills (URLs seulement) ──
        if not archive_replaced_types(db, kill_id):
            return {"outcome": "failed", "reason": "archive"}

        encoding_node = f"{socket.gethostname()}/{os.getpid()}"
        rows_ok = True
        for asset_type, path in (("horizontal", out_h), ("vertical", out_v),
                                 ("vertical_low", out_vl)):
            url = uploads.get(asset_type)
            if not url:
                continue
            probe = probe_video(path)
            rows_ok &= insert_asset_row(db, {
                "kill_id": kill_id,
                "version": version,
                "type": asset_type,
                "url": url,
                "r2_key": r2_client.versioned_key(game_id, kill_id, version, asset_type),
                "width": probe.get("width"),
                "height": probe.get("height"),
                "duration_ms": probe.get("duration_ms"),
                "codec": probe.get("codec") or "h264",
                "bitrate_kbps": probe.get("bitrate_kbps"),
                "size_bytes": os.path.getsize(path),
                "content_hash": content_hash(path),
                "encoder_args": {
                    "script": "reencode_catalog",
                    "fps": CLIP_FPS,
                    "codec_args": video_codec_args(
                        "low" if asset_type == "vertical_low" else "hq"),
                    "movflags": "+faststart",
                    "audio": "copy" if asset_type != "vertical_low" else "aac 80k",
                },
                "encoding_node": encoding_node,
                "is_current": True,
            })

        # PATCH kills : URLs SEULEMENT (jamais content_hash — piège 23505,
        # cf. reclip_from_ledger.py).
        url_patch = {URL_KEY_BY_TYPE[t]: u for t, u in uploads.items() if u}
        safe_update("kills", url_patch, "id", kill_id)

        result = {"outcome": "ok", "new_version": version,
                  "old_bytes": old_bytes, "new_bytes": new_bytes,
                  "rows_ok": rows_ok}

        # ── HLS opt-in : re-package depuis le nouveau v.mp4 ──────────
        if want_hls and uploads["vertical"]:
            from modules.hls_packager import package_clip
            master = await package_clip(kill_id, uploads["vertical"])
            if master:
                safe_update("kills", {"hls_master_url": master}, "id", kill_id)
            result["hls"] = bool(master)

        return result
    finally:
        try:
            for f in os.listdir(work):
                os.remove(os.path.join(work, f))
            os.rmdir(work)
        except Exception:
            pass


# ─── Main ─────────────────────────────────────────────────────────────

async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--apply", action="store_true",
                    help="Exécute réellement (défaut : dry-run, lecture seule).")
    ap.add_argument("--limit", type=int, default=None,
                    help="Cap le nombre de clips sélectionnés.")
    ap.add_argument("--min-mbps", type=float, default=3.0,
                    help="Seuil de débit (Mb/s) au-dessus duquel on ré-encode "
                         "(défaut 3.0 — le clipper actuel produit ~2,3).")
    ap.add_argument("--hls", action="store_true",
                    help="Re-packager aussi le HLS après chaque ré-encodage "
                         "(voir docstring — nécessite le fix GC + front HLS).")
    ap.add_argument("--no-retry-failed", action="store_true",
                    help="Ne pas retenter les kills en échec d'un run précédent.")
    args = ap.parse_args()

    db = get_db()
    if db is None:
        print("Supabase indisponible (.env)")
        return 1

    state = load_state()
    done = state.setdefault("done", {})
    skip_outcomes = {"ok", "kept_old", "skipped_no_game"}
    if args.no_retry_failed:
        skip_outcomes.add("failed")

    # ── SCAN incrémental : page de kills → assets → mesure → sélection.
    # S'arrête dès que --limit candidats sont trouvés (test rapide).
    candidates: list[dict] = []
    scanned = 0
    offset = 0
    total_current = 0
    total_estimated = 0
    heads_used = 0
    while True:
        page = fetch_page(db, "kills", {
            "select": "id,game_id,clip_url_horizontal,clip_url_vertical,"
                      "clip_url_vertical_low",
            "status": "eq.published",
            "clip_url_vertical": "not.is.null",
            "order": "created_at.asc",
        }, offset)
        if not page:
            break
        offset += len(page)

        todo = [k for k in page
                if (done.get(k["id"]) or {}).get("outcome") not in skip_outcomes]
        assets_by_kill = fetch_current_assets(db, [k["id"] for k in todo])
        for k in todo:
            scanned += 1
            m = measure_kill(k, assets_by_kill.get(k["id"], {}))
            heads_used += 1 if m["missing_meta"] else 0
            if m["mbps"] > args.min_mbps:
                k["_measure"] = m
                k["_assets"] = assets_by_kill.get(k["id"], {})
                candidates.append(k)
                total_current += m["current_bytes"]
                total_estimated += estimate_new_bytes(m["duration_s"])
                if args.limit and len(candidates) >= args.limit:
                    break
        if args.limit and len(candidates) >= args.limit:
            break
        if len(page) < 1000:
            break

    # ── Rapport ──
    nvenc = has_nvenc()
    per_clip = EST_SECONDS_PER_CLIP_NVENC if nvenc else EST_SECONDS_PER_CLIP_X264
    est_hours = len(candidates) * per_clip / 3600
    print("=" * 66)
    print("  reencode_catalog — stock publié > "
          f"{args.min_mbps:.1f} Mb/s  ({'APPLY' if args.apply else 'DRY-RUN'})")
    print("=" * 66)
    print(f"  kills scannés            : {scanned} (déjà traités : "
          f"{sum(1 for v in done.values() if v.get('outcome') in skip_outcomes)})")
    print(f"  candidats au ré-encodage : {len(candidates)}"
          f"{f' (cap --limit {args.limit})' if args.limit else ''}")
    print(f"  taille actuelle (h+v+vl) : {total_current / 1024**3:.2f} Go")
    print(f"  taille estimée après     : {total_estimated / 1024**3:.2f} Go "
          f"(cibles {TARGET_MBPS_HQ} Mb/s hq / {TARGET_MBPS_LOW} Mb/s low)")
    print(f"  encodeur                 : {'NVENC' if nvenc else 'libx264'} "
          f"→ ~{est_hours:.1f} h estimées ({per_clip:.0f} s/clip)")
    if heads_used:
        print(f"  (métadonnées manquantes → {heads_used} HEAD R2 utilisés)")
    for k in candidates[:10]:
        m = k["_measure"]
        print(f"    {k['id'][:8]}  {m['mbps']:5.2f} Mb/s  "
              f"{m['current_bytes'] / 1024**2:6.1f} Mo  ~{m['duration_s']:.0f}s")
    if len(candidates) > 10:
        print(f"    ... +{len(candidates) - 10} autres")

    if not args.apply:
        print("\nDry-run — aucune écriture (DB, R2, état). Relancer avec --apply.")
        return 0
    if not candidates:
        print("\nRien à faire.")
        return 0

    work_root = os.path.join(config.CLIPS_DIR, "reencode_catalog")
    os.makedirs(work_root, exist_ok=True)
    stats: dict[str, int] = {}
    t0 = time.monotonic()
    for i, k in enumerate(candidates, 1):
        kid = k["id"]
        try:
            res = await reencode_one(db, k, k["_assets"], work_root, args.hls)
        except Exception as e:
            log.error("reencode_crash", kill_id=kid[:8], error=str(e)[:200])
            res = {"outcome": "failed", "reason": "crash"}
        res["ts"] = datetime.now(timezone.utc).isoformat()
        done[kid] = res
        save_state(state)  # résumable : état durable après CHAQUE kill
        stats[res["outcome"]] = stats.get(res["outcome"], 0) + 1
        gain = ""
        if res.get("old_bytes") and res.get("new_bytes"):
            gain = (f"  {res['old_bytes'] / 1024**2:.1f} → "
                    f"{res['new_bytes'] / 1024**2:.1f} Mo")
        print(f"[{i:>4}/{len(candidates)}] {kid[:8]} → {res['outcome']}{gain}")

    elapsed = time.monotonic() - t0
    print(f"\nRÉSULTAT en {elapsed / 60:.1f} min : {stats}")
    print(f"État : {STATE_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
