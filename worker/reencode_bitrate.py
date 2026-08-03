"""reencode_bitrate — ramène les clips déjà publiés au nouveau débit.

Contexte (03/08/2026). Mesure des fichiers servis en production :

    h.mp4       1920x1080  60 fps  40,0 s  19,43 Mo  4,07 Mbps
    v.mp4       1080x1920  60 fps  40,0 s  19,43 Mo  4,07 Mbps
    v_low.mp4    540x 960  60 fps  40,0 s   6,09 Mo  1,28 Mbps

Lire sans s'arrêter demandait donc 4 Mbps EN CONTINU sur la variante
haute définition. Le lecteur remplissait quelques secondes de tampon, les
vidait, puis attendait — c'est le gel signalé sur /scroll « au bout de 5,
parfois 10 secondes », variable selon la connexion du moment.

`services/ffmpeg_ops.py` est passé à 30 fps / crf 25 / maxrate 2,5M pour
les nouveaux clips. Ce script applique le même traitement au stock déjà
en ligne, sans repasser par les VOD : il réencode les fichiers R2
existants. C'est une génération de compression en plus, donc le pire cas
— comparaison VMAF sur un clip réel :

    crf 23 / max 3M    13,1 Mo   2,75 Mbps   VMAF 92,3
    crf 25 / max 2,5M  10,8 Mo   2,27 Mbps   VMAF 89,6   <- retenu
    crf 26 / max 2M     8,9 Mo   1,87 Mbps   VMAF 85,7

Ce que le script NE refait pas, et pourquoi :

  * pas de recadrage — le 9:16 est déjà appliqué dans le fichier source ;
    repasser le filtre recadrerait un recadrage ;
  * pas de mise à l'échelle — les dimensions sont déjà les bonnes ;
  * pas de `loudnorm` — la normalisation EBU R128 est déjà dans la piste ;
  * pas de réencodage audio — `-c:a copy`, l'AAC 128k ne pèse que
    0,13 Mbps et le recopier est sans perte.

Versionnement : les nouveaux fichiers montent en v{N+1}, les lignes
`kill_assets` précédentes passent en `is_current=FALSE`, et
`kills.clip_url_*` bascule sur les nouvelles URLs. Rien n'est écrasé —
un retour en arrière consiste à réactiver les lignes précédentes. Les
anciennes versions se récupèrent ensuite avec
`python r2_cleanup.py --apply-versioned`.

Modes :

    python reencode_bitrate.py                    # audit, n'écrit rien
    python reencode_bitrate.py --limit 5 --apply  # lot de test
    python reencode_bitrate.py --apply            # tout le stock

Faire tourner le lot de test d'abord et regarder les clips à l'œil sur
/scroll avant de lancer la totale.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import tempfile

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import httpx
import structlog

from services import r2_client
from services.clip_hash import content_hash
from services.ffmpeg_ops import video_codec_args
from services.media_probe import probe_video
from services.supabase_client import get_db, safe_select, safe_update

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.dev.ConsoleRenderer(),
    ]
)
log = structlog.get_logger()

# Les trois variantes vidéo. `thumbnail` est une image, elle est reportée
# telle quelle sur la nouvelle version sans réencodage.
VIDEO_TYPES = ("horizontal", "vertical", "vertical_low")

# Au-delà de ce débit, le fichier est encore à l'ancien réglage. En
# dessous, il est déjà passé — le script le saute, ce qui rend une
# reprise après interruption sans effet de bord.
STALE_BITRATE_KBPS = 3000

# Colonne `kills` à mettre à jour pour chaque type d'asset.
URL_COLUMN = {
    "horizontal": "clip_url_horizontal",
    "vertical": "clip_url_vertical",
    "vertical_low": "clip_url_vertical_low",
}


def fetch_current_assets(limit: int | None) -> dict[str, list[dict]]:
    """Assets vidéo courants, groupés par kill_id.

    Ne retient que les kills dont AU MOINS une variante dépasse encore le
    seuil de débit : un kill déjà traité n'a rien à faire dans le lot.
    """
    # safe_select préfixe lui-même les filtres par `eq.`, d'où la chaîne
    # "true" en minuscules : passer le booléen Python produirait `eq.True`,
    # que PostgREST rejette.
    rows = safe_select(
        "kill_assets",
        columns="kill_id,version,type,url,r2_key,bitrate_kbps,size_bytes,duration_ms",
        is_current="true",
        _limit=100000,
    )
    by_kill: dict[str, list[dict]] = {}
    for r in rows:
        if r.get("type") not in VIDEO_TYPES:
            continue
        by_kill.setdefault(r["kill_id"], []).append(r)

    stale = {
        kid: assets
        for kid, assets in by_kill.items()
        if any((a.get("bitrate_kbps") or 0) > STALE_BITRATE_KBPS for a in assets)
    }
    if limit is not None:
        stale = dict(list(stale.items())[:limit])
    return stale


def game_id_for(kill_id: str, assets: list[dict]) -> str | None:
    """Le game_id vit dans la clé R2 : clips/{game_id}/{kill_id}/v{N}/...

    Le relire depuis la clé évite une requête par kill, et c'est de toute
    façon la valeur qui a servi à écrire le chemin — donc la bonne.
    """
    for a in assets:
        key = a.get("r2_key") or ""
        parts = key.split("/")
        if len(parts) >= 4 and parts[0] == "clips":
            return parts[1]
    return None


async def download(url: str, dest: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as c:
            async with c.stream("GET", url) as r:
                if r.status_code != 200:
                    log.warn("download_failed", url=url[-60:], status=r.status_code)
                    return False
                with open(dest, "wb") as f:
                    async for chunk in r.aiter_bytes(1 << 20):
                        f.write(chunk)
        return os.path.getsize(dest) > 0
    except Exception as e:
        log.warn("download_error", url=url[-60:], error=str(e)[:160])
        return False


async def reencode(src: str, dest: str, asset_type: str) -> bool:
    """Réencode à 30 fps au nouveau débit, sans retoucher le cadrage.

    `-c:a copy` : la piste AAC est déjà normalisée EBU R128 par le
    clipper d'origine, la recopier est sans perte et instantané.
    """
    variant = "low" if asset_type == "vertical_low" else "hq"
    args = [
        "ffmpeg", "-v", "error", "-y",
        "-i", src,
        "-vf", "fps=30",
        *video_codec_args(variant),
        "-c:a", "copy",
        "-movflags", "+faststart",
        dest,
    ]
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate()
    if proc.returncode != 0:
        log.error("ffmpeg_failed", asset=asset_type, error=(err or b"").decode()[:300])
        return False
    return os.path.exists(dest) and os.path.getsize(dest) > 0


def archive_prior(kill_id: str) -> None:
    """Passe les lignes courantes du kill en is_current=FALSE.

    Obligatoire avant d'insérer la version suivante : l'index unique de
    la migration 026 n'admet qu'une ligne courante par (kill_id, type).
    """
    db = get_db()
    if db is None:
        return
    try:
        httpx.patch(
            f"{db.base}/kill_assets",
            headers={**db.headers, "Prefer": "return=minimal"},
            params={"kill_id": f"eq.{kill_id}", "is_current": "eq.true"},
            json={"is_current": False},
            timeout=20.0,
        )
    except Exception as e:
        log.warn("archive_failed", kill_id=kill_id[:8], error=str(e)[:160])


def insert_asset(row: dict) -> None:
    db = get_db()
    if db is None:
        return
    try:
        httpx.post(
            f"{db.base}/kill_assets",
            headers={**db.headers, "Prefer": "return=minimal"},
            json={k: v for k, v in row.items() if v is not None},
            timeout=20.0,
        )
    except Exception as e:
        log.warn("insert_failed", kill_id=row["kill_id"][:8], error=str(e)[:160])


async def process_kill(
    kill_id: str,
    assets: list[dict],
    workdir: str,
    apply: bool,
) -> dict:
    """Traite un kill. Retourne les octets avant / après pour le bilan."""
    game_id = game_id_for(kill_id, assets)
    if not game_id:
        log.warn("no_game_id", kill_id=kill_id[:8])
        return {"before": 0, "after": 0, "done": False}

    version = max(int(a.get("version") or 1) for a in assets) + 1
    before = after = 0
    pending_rows: list[dict] = []
    new_urls: dict[str, str] = {}

    # ─── Étape 1 : tout produire et téléverser, sans rien publier ──────
    # Les lignes kill_assets sont préparées mais gardées de côté. Tant
    # qu'une variante peut encore échouer, l'ancienne version doit rester
    # celle que le site sert.
    for a in assets:
        asset_type = a["type"]
        src = os.path.join(workdir, f"{kill_id}_{asset_type}_src.mp4")
        dst = os.path.join(workdir, f"{kill_id}_{asset_type}_out.mp4")

        try:
            if not await download(a["url"], src):
                return {"before": 0, "after": 0, "done": False}
            before += os.path.getsize(src)

            if not await reencode(src, dst, asset_type):
                return {"before": 0, "after": 0, "done": False}
            after += os.path.getsize(dst)

            if apply:
                url = await r2_client.upload_versioned(
                    game_id, kill_id, version, dst, asset_type
                )
                if not url:
                    log.error("upload_failed", kill_id=kill_id[:8], asset=asset_type)
                    return {"before": 0, "after": 0, "done": False}
                new_urls[asset_type] = url

                probe = await asyncio.to_thread(probe_video, dst)
                pending_rows.append({
                    "kill_id": kill_id,
                    "version": version,
                    "type": asset_type,
                    "url": url,
                    "r2_key": r2_client.versioned_key(
                        game_id, kill_id, version, asset_type
                    ),
                    "width": probe.get("width"),
                    "height": probe.get("height"),
                    "duration_ms": probe.get("duration_ms"),
                    "codec": probe.get("codec") or "h264",
                    "bitrate_kbps": probe.get("bitrate_kbps"),
                    "size_bytes": os.path.getsize(dst),
                    "content_hash": await asyncio.to_thread(content_hash, dst),
                    "encoder_args": "fps=30 " + " ".join(
                        video_codec_args(
                            "low" if asset_type == "vertical_low" else "hq"
                        )
                    ),
                    "is_current": True,
                })
        finally:
            for p in (src, dst):
                try:
                    os.remove(p)
                except OSError:
                    pass

    # ─── Étape 2 : publier ────────────────────────────────────────────
    # L'archivage doit précéder les insertions : l'index unique de la
    # migration 026 n'admet qu'une ligne courante par (kill_id, type), et
    # archiver après aurait repassé les nouvelles lignes en is_current=FALSE.
    if apply and pending_rows:
        archive_prior(kill_id)
        for row in pending_rows:
            insert_asset(row)
        patch = {URL_COLUMN[t]: u for t, u in new_urls.items() if t in URL_COLUMN}
        if patch:
            safe_update("kills", patch, "id", kill_id)

    return {"before": before, "after": after, "done": True}


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true",
                    help="écrit réellement (upload R2 + lignes kill_assets + kills)")
    ap.add_argument("--limit", type=int, default=None,
                    help="ne traiter que les N premiers kills")
    ap.add_argument("--concurrency", type=int, default=2,
                    help="kills traités en parallèle (défaut 2)")
    args = ap.parse_args()

    stale = fetch_current_assets(args.limit)
    total_files = sum(len(v) for v in stale.values())
    est_before = sum(
        sum((a.get("size_bytes") or 0) for a in v) for v in stale.values()
    )
    log.info(
        "audit",
        kills=len(stale),
        fichiers=total_files,
        poids_actuel_go=round(est_before / 1e9, 2),
        mode=("APPLIQUE" if args.apply else "audit seul"),
    )
    if not stale:
        log.info("rien_a_faire")
        return
    if not args.apply:
        log.info("relancer_avec_apply_pour_ecrire")

    sem = asyncio.Semaphore(max(1, args.concurrency))
    totals = {"before": 0, "after": 0, "ok": 0, "ko": 0}

    with tempfile.TemporaryDirectory(prefix="reencode_") as workdir:
        async def run(kill_id: str, assets: list[dict]) -> None:
            async with sem:
                res = await process_kill(kill_id, assets, workdir, args.apply)
                if res["done"]:
                    totals["ok"] += 1
                    totals["before"] += res["before"]
                    totals["after"] += res["after"]
                    log.info(
                        "kill_ok",
                        kill_id=kill_id[:8],
                        avant_mo=round(res["before"] / 1048576, 1),
                        apres_mo=round(res["after"] / 1048576, 1),
                        fait=totals["ok"],
                        reste=len(stale) - totals["ok"] - totals["ko"],
                    )
                else:
                    totals["ko"] += 1

        await asyncio.gather(*(run(k, v) for k, v in stale.items()))

    gain = totals["before"] - totals["after"]
    log.info(
        "bilan",
        kills_ok=totals["ok"],
        kills_ko=totals["ko"],
        avant_go=round(totals["before"] / 1e9, 2),
        apres_go=round(totals["after"] / 1e9, 2),
        gain_pct=(round(100 * gain / totals["before"]) if totals["before"] else 0),
    )
    if args.apply:
        log.info("purger_le_cache_cloudflare_puis_r2_cleanup_apply_versioned")


if __name__ == "__main__":
    asyncio.run(main())
