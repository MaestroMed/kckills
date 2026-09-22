"""
TWITCH_VOD — source VOD de secours (et de référence) : les past broadcasts
Twitch de la chaîne officielle LEC.

Pourquoi (2026-09-22) : YouTube bloque l'IP du worker par vagues (« Sign in
to confirm you're not a bot », 18 puis 22/09/2026, tous les player_client,
PO token inclus) et les VODs co-stream YouTube ont des trous (TH W2 G2 et
SK W6 G1 non couvertes). Twitch sert les lives LEC complets en 1080p60,
sans authentification, ~14 Mo/s, avec l'heure exacte de début du live
(`timestamp`). Combinée à l'horloge du feed (epochs réels, pauses incluses),
la position d'un kill dans la VOD est une simple soustraction : aucune
dérive, aucune pause à deviner.

API :
    vod = await find_vod_for_epoch(epoch_ms)            # VOD qui couvre l'instant
    ok = await download_section(vod.video_id, 1200, 4200, "D:/.../x.mp4")
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass

import structlog

from services.local_paths import LocalPaths

log = structlog.get_logger()

DEFAULT_CHANNEL = os.getenv("KCKILLS_TWITCH_CHANNEL", "lec")
CACHE_DIR = os.path.join(os.path.dirname(LocalPaths.vods_dir()), "twitch")
LIST_TTL_S = 3600          # la liste des archives est rafraîchie au plus 1×/h
YTDLP_TIMEOUT_S = 1800


@dataclass(frozen=True)
class TwitchVod:
    video_id: str          # "v2878362754"
    start_epoch_s: int     # début du live (UTC)
    duration_s: int
    title: str = ""
    channel: str = DEFAULT_CHANNEL

    @property
    def url(self) -> str:
        return f"https://www.twitch.tv/videos/{self.video_id.lstrip('v')}"

    @property
    def end_epoch_s(self) -> int:
        return self.start_epoch_s + self.duration_s

    def covers(self, epoch_s: float, margin_s: int = 0) -> bool:
        return self.start_epoch_s + margin_s <= epoch_s <= self.end_epoch_s - margin_s

    def position_of(self, epoch_s: float) -> float:
        """Position (s) dans la VOD de l'instant réel `epoch_s`, SANS délai
        de diffusion (voir twitch_sync pour la calibration)."""
        return epoch_s - self.start_epoch_s


LIVE_SLACK_S = 20 * 60      # fin mesurée à moins de 20 min de la mesure = peut-être encore live


def _maybe_live(entry: dict, now: int) -> bool:
    """La VOD était-elle encore en cours d'enregistrement quand on l'a
    mesurée ? (entrées anciennes sans `measured_at` : figées, jamais live)."""
    measured = int(entry.get("measured_at") or 0)
    if not measured or now - measured < 120:
        return False
    return int(entry.get("start", 0)) + int(entry.get("duration", 0)) >= measured - LIVE_SLACK_S


def _cache_path(channel: str) -> str:
    return os.path.join(CACHE_DIR, f"archives_{channel}.json")


def _load_cache(channel: str) -> dict:
    try:
        with open(_cache_path(channel), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"listed_at": 0, "vods": {}}


def _save_cache(channel: str, data: dict) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    tmp = _cache_path(channel) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, _cache_path(channel))


async def _ytdlp(*args: str, timeout: int = 300) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        sys.executable, "-m", "yt_dlp", "--no-warnings", *args,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return -1, "", "timeout"
    return proc.returncode or 0, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")


async def list_archives(channel: str = DEFAULT_CHANNEL, limit: int = 80, force: bool = False) -> list[TwitchVod]:
    """Past broadcasts de la chaîne, avec heure de début. Les métadonnées
    d'une VOD sont immuables -> cache disque ; seule la liste est rafraîchie."""
    cache = _load_cache(channel)
    if force or time.time() - cache.get("listed_at", 0) > LIST_TTL_S:
        rc, out, err = await _ytdlp(
            "--flat-playlist", "--playlist-end", str(limit),
            "--print", "%(id)s\t%(duration)s\t%(title)s",
            f"https://www.twitch.tv/{channel}/videos?filter=archives&sort=time",
        )
        if rc != 0:
            log.warn("twitch_list_failed", channel=channel, err=err[-200:])
        else:
            listed = []
            for line in out.splitlines():
                parts = line.split("\t", 2)
                if len(parts) == 3 and parts[0].startswith("v"):
                    listed.append(parts)
            now = int(time.time())
            # heure de début : une requête par VOD, une seule fois dans sa vie…
            # sauf si elle était encore en cours d'enregistrement quand on l'a
            # mesurée (live en cours : sa durée grandit jusqu'à la fin du live).
            missing = [p for p in listed if p[0] not in cache["vods"] or _maybe_live(cache["vods"][p[0]], now)]
            for i in range(0, len(missing), 10):
                chunk = missing[i:i + 10]
                rc2, out2, err2 = await _ytdlp(
                    "--skip-download", "--print", "%(id)s\t%(timestamp)s\t%(duration)s",
                    *[f"https://www.twitch.tv/videos/{p[0].lstrip('v')}" for p in chunk],
                    timeout=600,
                )
                titles = {p[0]: p[2] for p in chunk}
                for line in out2.splitlines():
                    vid, ts, dur = (line.split("\t") + ["", "", ""])[:3]
                    if vid.startswith("v") and ts.isdigit():
                        cache["vods"][vid] = {"start": int(ts), "duration": int(float(dur or 0)),
                                              "title": titles.get(vid, ""), "measured_at": now}
                if rc2 != 0:
                    log.warn("twitch_meta_partial", err=err2[-200:])
            cache["listed_at"] = int(time.time())
            _save_cache(channel, cache)
    return sorted(
        (TwitchVod(vid, v["start"], v["duration"], v.get("title", ""), channel) for vid, v in cache["vods"].items()),
        key=lambda v: v.start_epoch_s,
    )


async def find_vod_for_epoch(epoch_ms: int, channel: str = DEFAULT_CHANNEL,
                            until_ms: int | None = None) -> TwitchVod | None:
    """VOD dont le live couvre l'instant `epoch_ms` (±60 s de marge).

    `until_ms` : exige en plus que la VOD aille jusqu'à cet instant (fin de
    game + marge) — une game qui vient de finir sur un live encore en cours
    n'est prise qu'une fois la VOD assez longue (sinon None : réessayer)."""
    epoch_s = epoch_ms / 1000.0
    until_s = (until_ms / 1000.0) if until_ms else None
    for force in (False, True):
        vods = await list_archives(channel, force=force)
        hits = [v for v in vods if v.start_epoch_s - 60 <= epoch_s <= v.end_epoch_s + 60]
        if until_s is not None:
            hits = [v for v in hits if v.end_epoch_s >= until_s]
        if hits:
            return max(hits, key=lambda v: v.duration_s)
    log.warn("twitch_vod_not_found", channel=channel, epoch_s=int(epoch_s),
             until_s=int(until_s) if until_s else None)
    return None


async def download_section(video_id: str, start_s: float, end_s: float, dest: str, max_height: int = 1080) -> bool:
    """Télécharge [start_s, end_s] de la VOD (HLS Twitch) sans ré-encodage.

    ffmpeg coupe au keyframe (segments Twitch ~2 s) : la position exacte du
    fichier n'est donc PAS supposée — twitch_sync calibre dans les
    coordonnées du fichier lui-même (lecture du chrono)."""
    if os.path.exists(dest) and os.path.getsize(dest) > 50 * 1024 * 1024:
        log.info("twitch_section_cache_hit", dest=dest)
        return True
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    part = dest + ".part.mp4"
    rc, _out, err = await _ytdlp(
        "-f", f"best[height<={max_height}]/best",
        "--download-sections", f"*{max(0, int(start_s))}-{int(end_s)}",
        "--concurrent-fragments", "8",
        "-o", part,
        f"https://www.twitch.tv/videos/{video_id.lstrip('v')}",
        timeout=YTDLP_TIMEOUT_S,
    )
    if rc != 0 or not os.path.exists(part):
        log.error("twitch_section_failed", video_id=video_id, err=err[-300:])
        return False
    os.replace(part, dest)
    log.info("twitch_section_done", video_id=video_id, start=int(start_s), end=int(end_s),
             size_mb=round(os.path.getsize(dest) / 1048576))
    return True
