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

    # ─── Gemini model selection (Wave 33 — May 2026, Gemini 3.5 Flash) ─
    # Per-stage model selection.
    #
    # May 2026 state of play (research-confirmed) :
    #   * Gemini 3.5 Flash       : GA 2026-05-19. NEW SOTA mid-tier —
    #     beats 3.1 Pro on coding/agentic, 4× faster, $1.50/$9 per M
    #     tokens. New thinking-budget API (enum minimal|low|medium|high).
    #     Implicit cache discount $0.15/M for reused prompt prefix.
    #     → New default for `premium` tier.
    #   * Gemini 2.5 Pro         : GA, paid-only since Apr 1, 2026.
    #     $1.25/$10 per M tokens. SAFE legacy choice — moved to the new
    #     `pro-legacy` tier for budgeted one-shot backfills.
    #   * Gemini 3.1 Pro Preview : PREVIEW = shutdown risk (Gemini 3 Pro
    #     got killed Mar 9, 2026). Kept in `experimental` only.
    #   * Gemini 3 Flash         : GA, frontier-class at $0.30/$2.50.
    #     Sweet-spot for mid-stakes (quote extraction, captions).
    #   * Gemini 3.1 Flash-Lite  : GA, $0.10/$0.40. Default for QC / OCR.
    #
    # Recommended configs :
    #   GEMINI_TIER=free                              → all flash-lite
    #   GEMINI_TIER=balanced                          → 3-flash analyzer
    #   GEMINI_TIER=premium                           → 3.5-flash analyzer
    #   GEMINI_TIER=pro-legacy                        → 2.5-pro analyzer
    #
    # Score-based auto-upgrade :
    #   GEMINI_AUTO_UPGRADE_SCORE_THRESHOLD=8.0
    #     If a predicted/measured score crosses this threshold, the
    #     analyzer bumps to the `premium` tier (3.5-flash) regardless
    #     of the base tier. Cheap-by-default, premium-when-it-counts.
    #
    # Per-stage env vars (GEMINI_MODEL_ANALYZER / _QC / _OFFSET / _QUOTES)
    # override the tier preset and the auto-upgrade rule.

    _GEMINI_TIER = (os.getenv("KCKILLS_GEMINI_TIER", "free") or "free").lower()
    _TIER_DEFAULTS = {
        "free": {  # default — Gemini 3.1 Flash-Lite (GA 2026-05-07).
            # Replaced 2.5 Flash-Lite at the same $0.10/$0.40 price tier,
            # with 64 % faster throughput, 2.5× faster TTFT, +62 %
            # Intelligence Index. Free tier RPD = 500 (was 1000 on 2.5).
            "analyzer": "gemini-3.1-flash-lite",
            "qc":       "gemini-3.1-flash-lite",
            "offset":   "gemini-3.1-flash-lite",
            "quotes":   "gemini-3.1-flash-lite",
        },
        "balanced": {  # 3 Flash for descriptions, 3.1 Lite for QC
            "analyzer": "gemini-3-flash",
            "qc":       "gemini-3.1-flash-lite",
            "offset":   "gemini-3.1-flash-lite",
            "quotes":   "gemini-3-flash",
        },
        "premium": {  # Wave 33 — UPGRADED : 3.5-flash for analyzer.
            # Was 2.5-pro pre-Wave-33. 3.5 Flash beats 3.1 Pro on agentic,
            # 4× faster, similar price band. Use `pro-legacy` if you
            # really want 2.5-pro for backward compat.
            "analyzer": "gemini-3.5-flash",
            "qc":       "gemini-3.1-flash-lite",
            "offset":   "gemini-3.1-flash-lite",
            "quotes":   "gemini-3-flash",
        },
        "pro-legacy": {  # Kept for budgeted one-shots that pre-budgeted 2.5-pro
            "analyzer": "gemini-2.5-pro",
            "qc":       "gemini-3.1-flash-lite",
            "offset":   "gemini-3.1-flash-lite",
            "quotes":   "gemini-3-flash",
        },
        "experimental": {  # Pro 3.1 Preview (shutdown risk!)
            "analyzer": "gemini-3.1-pro-preview",
            "qc":       "gemini-3.1-flash-lite",
            "offset":   "gemini-3.1-flash-lite",
            "quotes":   "gemini-3.1-pro-preview",
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
    # Wave 33 — added `quotes` stage. Was hardcoded `gemini-3.1-flash-lite`
    # inside quote_extractor.py via `config.GEMINI_MODEL_QC`. Now has its
    # own override so it can sit at the standard tier without dragging the
    # OCR / QC tasks up with it.
    GEMINI_MODEL_QUOTES = os.getenv(
        "GEMINI_MODEL_QUOTES",
        os.getenv("GEMINI_MODEL", _TIER["quotes"]),
    )

    # Wave 33 — auto-upgrade rule. When a kill's predicted/measured
    # highlight_score crosses this threshold, the analyzer routes that
    # single call to the premium tier (gemini-3.5-flash) regardless of
    # KCKILLS_GEMINI_TIER. Leave empty / 0 to disable.
    # Recommended : 8.0 = top 5-10% of clips, where editorial quality
    # matters most. Cost impact bounded by the % of clips that cross it.
    @property
    def GEMINI_AUTO_UPGRADE_SCORE_THRESHOLD(self) -> float | None:
        raw = os.getenv("GEMINI_AUTO_UPGRADE_SCORE_THRESHOLD", "").strip()
        if not raw:
            return None
        try:
            v = float(raw)
            return v if v > 0 else None
        except ValueError:
            return None

    # The model used when the auto-upgrade rule fires. Defaults to the
    # `premium` tier's analyzer choice (3.5-flash post-Wave-33) but can
    # be overridden if you want to land somewhere else (e.g. 2.5-pro for
    # an editorial backfill).
    GEMINI_AUTO_UPGRADE_MODEL = os.getenv(
        "GEMINI_AUTO_UPGRADE_MODEL",
        _TIER_DEFAULTS["premium"]["analyzer"],
    )

    # Wave 33 — Gemini 3.5 Flash thinking budget (string enum, NEW API).
    # Values : minimal, low, medium (default), high. Higher = better
    # quality on multi-step tasks but more output tokens (= more $).
    # Only applied to models that support thinking budget — currently
    # 3.5-flash. Older models ignore this and use their own defaults.
    GEMINI_THINKING_BUDGET = (
        os.getenv("KCKILLS_GEMINI_THINKING", "medium") or "medium"
    ).lower()

    # Video token resolution. "default" = 300 tokens/sec (best quality),
    # "low" = 100 tokens/sec (3x cheaper, good enough for short clips).
    # Set to "low" if you want to halve cost on Pro 2.5 / Pro 3.1.
    GEMINI_MEDIA_RESOLUTION = os.getenv("KCKILLS_GEMINI_MEDIA_RES", "default")

    # Wave 33 — exposed for the auto-upgrade selector + dashboard cost
    # calc. Bare-bones helper so callers don't have to redo the tier
    # lookup themselves.
    @classmethod
    def gemini_model_for_stage(cls, stage: str) -> str:
        """Resolve the configured model for a stage name.

        Stages : "analyzer" | "qc" | "offset" | "quotes".
        Falls back to GEMINI_MODEL_QC for unknown stages so a typo never
        sends a free-tier task to the premium model by surprise.
        """
        mapping = {
            "analyzer": cls.GEMINI_MODEL_ANALYZER,
            "qc":       cls.GEMINI_MODEL_QC,
            "offset":   cls.GEMINI_MODEL_OFFSET,
            "quotes":   cls.GEMINI_MODEL_QUOTES,
        }
        return mapping.get(stage, cls.GEMINI_MODEL_QC)

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
