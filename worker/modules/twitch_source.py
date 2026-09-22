"""
TWITCH_SOURCE — source vidéo Twitch du démon (transitioner + clipper).

Depuis l'été 2026, YouTube bloque l'IP du PC worker (« Sign in to confirm
you're not a bot », tous clients, PO token inclus). Les past broadcasts
Twitch officiels — chaîne `lec` pour la LEC, `riotgames` pour Worlds, MSI et
First Stand — sont en 1080p60, sans authentification, et se calent sur
l'heure réelle du feed (modules/twitch_sync) : clips exacts même après une
pause, sans lecture de chrono par kill.

Règles :
  * une game n'est éligible qu'une fois TERMINÉE dans le feed (horloge
    complète en cache, écrite par le harvester) et jouée il y a moins de
    KCKILLS_TWITCH_MAX_AGE_DAYS jours (les archives Twitch expirent) ;
  * les chaînes sont essayées selon la ligue du match ; la calibration du
    chrono départage (une rediffusion qui couvrirait la même heure échoue) ;
  * une game dont la section n'est pas encore prête (VOD du live encore
    trop courte, budget de téléchargement de la passe épuisé) est
    « en attente » : le clipper REPORTE ses jobs sans consommer de tentative ;
  * KCKILLS_TWITCH_SOURCE=0 rend la main au tout-YouTube.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

import structlog

from config import config
from modules import feed_clock, twitch_sync
from services.supabase_client import safe_select

log = structlog.get_logger()


def _env_on(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip().lower() not in ("0", "false", "off", "no", "")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


ENABLED = _env_on("KCKILLS_TWITCH_SOURCE")
MAX_AGE_DAYS = _env_int("KCKILLS_TWITCH_MAX_AGE_DAYS", 50)
# Après la fin de game, on attend la VOD Twitch (liste rafraîchie, live qui
# continue) au plus ce délai avant de se rabattre sur YouTube.
PENDING_WINDOW_S = _env_int("KCKILLS_TWITCH_PENDING_MIN", 120) * 60
# Téléchargements de section par passe du clipper (≈ 3-5 min chacun, le
# module a 30 min de plafond).
MAX_NEW_SECTIONS_PER_PASS = _env_int("KCKILLS_TWITCH_SECTIONS_PER_PASS", 2)
DEFAULT_CHANNELS = [c.strip() for c in os.getenv("KCKILLS_TWITCH_CHANNELS", "lec,riotgames").split(",") if c.strip()]
LEAGUE_CHANNELS: dict[str, list[str]] = {
    "lec": ["lec"],
    "worlds": ["riotgames"],
    "msi": ["riotgames"],
    "first_stand": ["riotgames"],
}
# Règle LoL des séries : ≤ 10 s entre deux kills, 30 s pour le 5e.
MULTIKILL_GAP_MS = 10_000
PENTA_GAP_MS = 30_000
_UNAVAILABLE_TTL_S = 1800

READY, PENDING, UNAVAILABLE = "ready", "pending", "unavailable"


@dataclass
class SourceDecision:
    status: str                                   # ready | pending | unavailable
    section: twitch_sync.GameSection | None = None
    reason: str = ""
    downloaded: bool = False                      # a coûté un téléchargement de section


_unavailable: dict[str, tuple[float, str]] = {}   # game ext -> (instant, raison)
_league_by_match: dict[str, str | None] = {}


def is_enabled() -> bool:
    return ENABLED


def finished_clock(game_ext_id: str | None) -> feed_clock.FeedClock | None:
    """Horloge complète en cache (game terminée) — lecture disque, gratuite."""
    return feed_clock.load_clock(game_ext_id) if game_ext_id else None


def _recent(clock: feed_clock.FeedClock, now_s: float | None = None) -> bool:
    now_ms = (now_s if now_s is not None else time.time()) * 1000
    return now_ms - clock.anchor_ms <= MAX_AGE_DAYS * 86_400_000


def eligible(game_ext_id: str | None) -> bool:
    """Transitioner : la game peut partir au clipper par Twitch (terminée,
    récente, source active) même sans VOD YouTube connue."""
    if not ENABLED:
        return False
    clock = finished_clock(game_ext_id)
    return bool(clock and _recent(clock))


def league_slug_for_match(match_id: str | None) -> str | None:
    """matches.tournament_id -> tournaments.league_id -> leagues.slug (mis en cache)."""
    if not match_id:
        return None
    if match_id in _league_by_match:
        return _league_by_match[match_id]
    slug = None
    try:
        m = safe_select("matches", "tournament_id", id=match_id) or []
        tid = (m[0] if m else {}).get("tournament_id")
        if tid:
            t = safe_select("tournaments", "league_id", id=tid) or []
            lid = (t[0] if t else {}).get("league_id")
            if lid:
                lg = safe_select("leagues", "slug", lolesports_league_id=lid) or []
                slug = (lg[0] if lg else {}).get("slug")
    except Exception as e:  # jamais bloquant : on retombe sur l'ordre par défaut
        log.debug("twitch_source_league_lookup_failed", match_id=match_id, error=str(e)[:120])
    _league_by_match[match_id] = slug
    return slug


def channels_for_league(slug: str | None) -> list[str]:
    """Chaînes de la ligue d'abord, puis les autres chaînes par défaut."""
    first = LEAGUE_CHANNELS.get(slug or "", [])
    return list(dict.fromkeys([*first, *DEFAULT_CHANNELS]))


def _mark_unavailable(ext: str, reason: str) -> SourceDecision:
    _unavailable[ext] = (time.time(), reason)
    return SourceDecision(UNAVAILABLE, reason=reason)


async def decide(game: dict, *, allow_download: bool = True) -> SourceDecision:
    """Source Twitch d'une game pour cette passe du clipper.

    `game` : row games avec au moins external_id et match_id.
    `allow_download` : False quand le budget de téléchargements de la passe
    est épuisé — une section déjà prête reste utilisable."""
    ext = game.get("external_id")
    if not ENABLED or not ext:
        return SourceDecision(UNAVAILABLE, reason="disabled" if not ENABLED else "no_external_id")
    miss = _unavailable.get(ext)
    if miss and time.time() - miss[0] < _UNAVAILABLE_TTL_S:
        return SourceDecision(UNAVAILABLE, reason=miss[1])
    clock = finished_clock(ext)
    if clock is None:
        # Pas d'horloge COMPLÈTE en cache : le harvester l'écrit quand il
        # moissonne une game terminée. Sans elle (game moissonnée par un
        # ancien chemin, feed sans état 'finished'), pas de reconstruction
        # ici — ~10 min de requêtes au feed par game, dans une passe du
        # clipper plafonnée à 30 min : on laisse le chemin YouTube.
        return _mark_unavailable(ext, "no_clock")
    if not _recent(clock):
        return _mark_unavailable(ext, "too_old")
    cached = twitch_sync.cached_game_section(clock)
    if cached is not None:
        return SourceDecision(READY, cached)
    ended_ago_s = time.time() - clock.end_ms / 1000.0
    if not allow_download:
        return SourceDecision(PENDING, reason="download_budget")
    section = None
    try:
        section = await twitch_sync.prepare_game_section(
            clock, channels=channels_for_league(league_slug_for_match(game.get("match_id"))))
    except Exception as e:
        log.warn("twitch_source_section_error", game=ext, error=str(e)[:200])
    if section is not None:
        return SourceDecision(READY, section, downloaded=True)
    if ended_ago_s < PENDING_WINDOW_S:
        return SourceDecision(PENDING, reason="vod_not_ready", downloaded=True)
    decision = _mark_unavailable(ext, "no_section")
    decision.downloaded = True
    return decision


# ─── Paramètres de découpe ──────────────────────────────────────────────────

SERIES_LEN = {"double": 2, "triple": 3, "quadra": 4, "penta": 5}
# Une série fait au plus 10 + 10 + 10 + 30 = 60 s : au-delà, donnée incohérente.
MAX_SERIES_SPAN_MS = 3 * MULTIKILL_GAP_MS + PENTA_GAP_MS


def sequence_start_ms(kill: dict, game_kills: list[dict], epoch_of=None) -> int:
    """Début de la série multi-kill qui se termine sur `kill`, pour que le
    clip la couvre en entier.

    Le libellé (double … penta) n'est porté que par le DERNIER kill de la
    série et donne sa longueur exacte : la série commence au (n-1)-ième kill
    précédent du même tueur. (L'ancienne remontée par écarts appliquait les
    30 s du 5e kill au PREMIER écart rencontré, donc un penta dont le 5e
    kill arrive > 10 s après le 4e gardait une fenêtre de kill simple.)
    `epoch_of` : instant d'un kill (défaut : event_epoch)."""
    ep = epoch_of or (lambda k: int(k.get("event_epoch") or 0))
    target = ep(kill)
    n = SERIES_LEN.get(kill.get("multi_kill") or "", 1)
    if n <= 1 or not target:
        return target
    prev = sorted((k for k in game_kills
                   if k.get("killer_champion") == kill.get("killer_champion")
                   and k.get("id") != kill.get("id") and k.get("status") != "duplicate"
                   and 0 < ep(k) <= target),
                  key=ep)
    chain = prev[-(n - 1):]
    if not chain:
        return target
    return max(ep(chain[0]), target - MAX_SERIES_SPAN_MS)


def clip_args(kill: dict, section: twitch_sync.GameSection, game_kills: list[dict],
              game_number: int | None = None) -> dict:
    """Arguments de clipper.clip_kill pour découper `kill` dans la section.

    Position dans le fichier = c + (event_epoch - ancre) / 1000 : on passe
    vod_offset = round(c) et game_time = temps réel depuis l'ancre, que
    clip_kill additionne (erreur ≤ 1 s, fenêtres de 10 à 30 s)."""
    clock = section.clock
    epoch = int(kill["event_epoch"])
    gt_wall = round((epoch - clock.anchor_ms) / 1000.0)
    ig = int(clock.ingame_seconds(epoch))
    timing = config.CLIP_TIMING.get(kill.get("multi_kill") or "default", config.CLIP_TIMING["default"])
    before, after = int(timing["before"]), int(timing["after"])
    span_s = (epoch - sequence_start_ms(kill, game_kills)) / 1000.0
    window_override = {"before": max(before, int(span_s) + 12), "after": after} if span_s > before - 12 else None
    ctx = f"Game {game_number or '?'}  T+{ig // 60:02d}:{ig % 60:02d}"
    return {
        "youtube_id": f"twitch_{section.vod_id}",
        "vod_offset_seconds": int(round(section.sync.c or 0)),
        "game_time_seconds": int(gt_wall),
        "multi_kill": kill.get("multi_kill"),
        "killer_champion": kill.get("killer_champion"),
        "victim_champion": kill.get("victim_champion"),
        "match_context": ctx,
        "local_vod_path": section.path,
        "window_override": window_override,
    }


def game_kills(game_id: str) -> list[dict]:
    """Kills de la game (pour les fenêtres de séries)."""
    return safe_select("kills", "id,event_epoch,killer_champion,status", game_id=game_id) or []
