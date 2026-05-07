"""LoLTok Worker — Configuration."""

import os
from dotenv import load_dotenv

# Path resolution is delegated to LocalPaths so the same Config works
# on Mehdi's Windows box (D:/kckills_worker), inside a Docker container
# (/cache/...), and on a fresh Linux dev VM (/var/cache/kckills). See
# worker/services/local_paths.py for the full resolver + env-var menu.
from services.local_paths import LocalPaths

load_dotenv()


class Config:
    # ─── Supabase ────────────────────────────────────────────
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_SERVICE_KEY: str = os.getenv("SUPABASE_SERVICE_KEY", "")

    # ─── Riot / LoL Esports ──────────────────────────────────
    LOLESPORTS_API_URL = "https://esports-api.lolesports.com/persisted/gw"
    LOLESPORTS_FEED_URL = "https://feed.lolesports.com/livestats/v1"
    LOLESPORTS_API_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"
    KC_CODES = {"KC"}

    # PR-loltok DH : LEC league id is no longer hardcoded as a class
    # constant. Single-source-of-truth is the `leagues` table accessed
    # via services.league_config.get_league_lolesports_id("lec").
    # Static lookup in services.league_id_lookup is the cold-start
    # fallback (DB unreachable / unseeded).
    #
    # `@property` is preserved (not deleted) because services.lolesports_api
    # falls back to `config.LEC_LEAGUE_ID` when no league_id is passed
    # explicitly — admin scripts and the legacy single-league code path
    # still rely on this default. Lazy resolution avoids triggering a
    # DB call on import.
    @property
    def LEC_LEAGUE_ID(self) -> str:
        from services.league_config import get_league_lolesports_id
        resolved = get_league_lolesports_id("lec")
        # Last-resort literal — same value that lived here pre-refactor.
        return resolved or "98767991302996019"

    # ─── YouTube ─────────────────────────────────────────────
    YOUTUBE_API_KEY: str = os.getenv("YOUTUBE_API_KEY", "")

    # ─── Cloudflare R2 ───────────────────────────────────────
    R2_ACCOUNT_ID: str = os.getenv("R2_ACCOUNT_ID", "")
    R2_ACCESS_KEY_ID: str = os.getenv("R2_ACCESS_KEY_ID", "")
    R2_SECRET_ACCESS_KEY: str = os.getenv("R2_SECRET_ACCESS_KEY", "")
    R2_BUCKET_NAME: str = os.getenv("R2_BUCKET_NAME", "loltok-clips")
    R2_PUBLIC_URL: str = os.getenv("R2_PUBLIC_URL", "")

    # ─── AI ──────────────────────────────────────────────────
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")

    # ─── Encoding ────────────────────────────────────────────
    # NVENC (NVIDIA GPU encoding) selection.
    #   "auto" : use NVENC if ffmpeg has h264_nvenc (default — best perf
    #            on a box with an RTX card; falls back to libx264 otherwise)
    #   "1"    : force NVENC (fail if unavailable)
    #   "0"    : force libx264 (debug or non-GPU machines)
    USE_NVENC = os.getenv("KCKILLS_USE_NVENC", "auto")

    # ─── Gemini model selection (PR12 — premium quality, April 2026) ─
    # Per-stage model selection.
    #
    # April 2026 state of play (research-confirmed) :
    #   * Gemini 3.1 Pro Preview : SOTA video (87.6% Video-MMMU) — but
    #     PREVIEW = shutdown risk (Gemini 3 Pro got killed Mar 9, 2026
    #     with no migration). NOT recommended for backfill work that
    #     must persist.
    #   * Gemini 2.5 Pro        : GA, paid-only since Apr 1, 2026.
    #     $1.25/$10 per M tokens. 87%+ video benchmarks. SAFE choice.
    #   * Gemini 3 Flash        : GA, frontier-class at $0.30/$2.50.
    #   * Gemini 3.1 Flash-Lite : GA, $0.25/$1.50. Better than 2.5
    #     Flash-Lite at same price tier. Default for QC / cheap reads.
    #
    # Recommended €45 KC-catalog backfill config (1 line in .env):
    #   GEMINI_TIER=premium
    # (Equivalent to:
    #   GEMINI_MODEL_ANALYZER=gemini-2.5-pro
    #   GEMINI_MODEL_QC=gemini-3.1-flash-lite
    #   GEMINI_MODEL_OFFSET=gemini-3.1-flash-lite
    # )
    #
    # Free-tier-only fallback (KCKILLS_GEMINI_TIER not set):
    #   All three = gemini-3.1-flash-lite (the safe, free, default).

    _GEMINI_TIER = (os.getenv("KCKILLS_GEMINI_TIER", "free") or "free").lower()
    _TIER_DEFAULTS = {
        "free": {  # default — Gemini 3.1 Flash-Lite (GA 2026-05-07).
            # Replaced 2.5 Flash-Lite at the same $0.25/$1.50 price tier,
            # with 64 % faster throughput, 2.5× faster TTFT, +62 %
            # Intelligence Index, and matching-or-beating 2.5 Flash on
            # most benchmarks. Strict upgrade. Free tier RPD dropped
            # from 1000 (2.5 Lite) → 500 (3.1 Lite) — fall back to
            # GEMINI_MODEL_ANALYZER=gemini-2.5-flash-lite if the worker
            # consistently exhausts the 500 RPD daily quota.
            "analyzer": "gemini-3.1-flash-lite",
            "qc":       "gemini-3.1-flash-lite",
            "offset":   "gemini-3.1-flash-lite",
        },
        "balanced": {  # paid Flash 3 for descriptions, 3.1 Lite for QC
            "analyzer": "gemini-3-flash",
            "qc":       "gemini-3.1-flash-lite",
            "offset":   "gemini-3.1-flash-lite",
        },
        "premium": {  # Pro 2.5 for descriptions (the €45 KC config)
            "analyzer": "gemini-2.5-pro",
            "qc":       "gemini-3.1-flash-lite",
            "offset":   "gemini-3.1-flash-lite",
        },
        "experimental": {  # Pro 3.1 Preview (shutdown risk!)
            "analyzer": "gemini-3.1-pro-preview",
            "qc":       "gemini-3.1-flash-lite",
            "offset":   "gemini-3.1-flash-lite",
        },
    }
    _TIER = _TIER_DEFAULTS.get(_GEMINI_TIER, _TIER_DEFAULTS["free"])

    # Per-stage env vars override the tier preset.
    GEMINI_MODEL_ANALYZER = os.getenv(
        "GEMINI_MODEL_ANALYZER",
        os.getenv("GEMINI_MODEL", _TIER["analyzer"]),
    )
    GEMINI_MODEL_QC = os.getenv(
        "GEMINI_MODEL_QC",
        os.getenv("GEMINI_MODEL", _TIER["qc"]),
    )
    GEMINI_MODEL_OFFSET = os.getenv(
        "GEMINI_MODEL_OFFSET",
        os.getenv("GEMINI_MODEL", _TIER["offset"]),
    )

    # Video token resolution. "default" = 300 tokens/sec (best quality),
    # "low" = 100 tokens/sec (3x cheaper, good enough for short clips).
    # Set to "low" if you want to halve cost on Pro 2.5 / Pro 3.1.
    GEMINI_MEDIA_RESOLUTION = os.getenv("KCKILLS_GEMINI_MEDIA_RES", "default")

    # ─── Discord ─────────────────────────────────────────────
    DISCORD_WEBHOOK_URL: str = os.getenv("DISCORD_WEBHOOK_URL", "")

    # ─── Worker ──────────────────────────────────────────────
    KC_TEAM_NAME = "Karmine Corp"
    # Default clip padding (used when multi_kill not known at clip time)
    CLIP_BEFORE_SECONDS = 5
    CLIP_AFTER_SECONDS = 5

    # Variable clip timing by context (from audit v2 blueprint)
    #
    # CRITICAL: the livestats feed reports kills ~10s AFTER they happen
    # (the KDA change appears in the NEXT frame, frames are 10s apart).
    # So `before` must be at least 12-15s to capture the actual action
    # BEFORE the kill, not the aftermath/death timer.
    CLIP_TIMING = {
        "penta":        {"before": 30, "after": 10, "total": 40},
        "quadra":       {"before": 30, "after": 10, "total": 40},
        "triple":       {"before": 30, "after": 10, "total": 40},
        "double":       {"before": 30, "after": 10, "total": 40},
        "baron_steal":  {"before": 30, "after": 10, "total": 40},
        "dragon_steal": {"before": 30, "after": 10, "total": 40},
        "solo_kill":    {"before": 30, "after": 10, "total": 40},
        "default":      {"before": 30, "after": 10, "total": 40},
    }

    # ─── Paths ───────────────────────────────────────────────
    # All paths are resolved through services.local_paths.LocalPaths so
    # they work cross-platform :
    #   * Mehdi's Windows box → D:/kckills_worker/<sub> (his Gen5 NVMe)
    #   * Linux container     → /var/cache/kckills/<sub> (or whatever
    #                           KCKILLS_DATA_ROOT mounts to)
    #   * Per-path overrides  → KCKILLS_VODS_DIR, KCKILLS_CLIPS_DIR,
    #                           KCKILLS_HLS_DIR, KCKILLS_THUMBNAILS_DIR,
    #                           KCKILLS_CACHE_DB
    # `@property` lets every existing call site (`config.CLIPS_DIR`)
    # keep working unchanged — re-resolved per access so env-var
    # changes during the same process actually take effect.
    @property
    def CLIPS_DIR(self) -> str:
        return LocalPaths.clips_dir()

    @property
    def HLS_DIR(self) -> str:
        return LocalPaths.hls_temp_dir()

    @property
    def THUMBNAILS_DIR(self) -> str:
        return LocalPaths.thumbnails_dir()

    @property
    def VODS_DIR(self) -> str:
        return LocalPaths.vods_dir()

    @property
    def CACHE_DB(self) -> str:
        return LocalPaths.cache_db()

    # ─── Data Dragon ─────────────────────────────────────────
    DDRAGON_VERSION = "16.7.1"


config = Config()
