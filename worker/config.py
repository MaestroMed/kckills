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
    CLIP_TIMING = {
        "penta":        {"before": 8, "after": 6, "total": 25},
        "quadra":       {"before": 6, "after": 4, "total": 18},
        "triple":       {"before": 5, "after": 4, "total": 16},
        "double":       {"before": 4, "after": 3, "total": 14},
        "baron_steal":  {"before": 10, "after": 6, "total": 25},
        "dragon_steal": {"before": 8, "after": 5, "total": 20},
        "solo_kill":    {"before": 4, "after": 3, "total": 10},
        "default":      {"before": 5, "after": 5, "total": 12},
    }

    # ─── Paths ───────────────────────────────────────────────
    CLIPS_DIR = os.path.join(os.path.dirname(__file__), "clips")
    THUMBNAILS_DIR = os.path.join(os.path.dirname(__file__), "thumbnails")
    CACHE_DB = os.path.join(os.path.dirname(__file__), "local_cache.db")

    # ─── Data Dragon ─────────────────────────────────────────
    DDRAGON_VERSION = "16.7.1"


config = Config()
