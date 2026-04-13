"""LoLTok Worker — Configuration."""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # ─── Supabase ────────────────────────────────────────────
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_SERVICE_KEY: str = os.getenv("SUPABASE_SERVICE_KEY", "")

    # ─── Riot / LoL Esports ──────────────────────────────────
    LOLESPORTS_API_URL = "https://esports-api.lolesports.com/persisted/gw"
    LOLESPORTS_FEED_URL = "https://feed.lolesports.com/livestats/v1"
    LOLESPORTS_API_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"
    LEC_LEAGUE_ID = "98767991302996019"
    KC_CODES = {"KC"}

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
    CLIPS_DIR = os.path.join(os.path.dirname(__file__), "clips")
    THUMBNAILS_DIR = os.path.join(os.path.dirname(__file__), "thumbnails")
    CACHE_DB = os.path.join(os.path.dirname(__file__), "local_cache.db")

    # ─── Data Dragon ─────────────────────────────────────────
    DDRAGON_VERSION = "16.7.1"


config = Config()
