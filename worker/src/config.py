import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # Supabase
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_SERVICE_KEY: str = os.getenv("SUPABASE_SERVICE_KEY", "")

    # Riot API
    RIOT_API_KEY: str = os.getenv("RIOT_API_KEY", "")

    # YouTube
    YOUTUBE_API_KEY: str = os.getenv("YOUTUBE_API_KEY", "")

    # Cloudflare R2
    R2_ACCOUNT_ID: str = os.getenv("R2_ACCOUNT_ID", "")
    R2_ACCESS_KEY_ID: str = os.getenv("R2_ACCESS_KEY_ID", "")
    R2_SECRET_ACCESS_KEY: str = os.getenv("R2_SECRET_ACCESS_KEY", "")
    R2_BUCKET_NAME: str = os.getenv("R2_BUCKET_NAME", "kckills-clips")
    R2_PUBLIC_URL: str = os.getenv("R2_PUBLIC_URL", "")

    # Discord
    DISCORD_WEBHOOK_URL: str = os.getenv("DISCORD_WEBHOOK_URL", "")

    # Worker config
    KC_TEAM_NAME: str = os.getenv("KC_TEAM_NAME", "Karmine Corp")
    POLL_INTERVAL: int = int(os.getenv("POLL_INTERVAL_SECONDS", "300"))
    CLIP_BEFORE: int = int(os.getenv("CLIP_BEFORE_SECONDS", "10"))
    CLIP_AFTER: int = int(os.getenv("CLIP_AFTER_SECONDS", "8"))

    # LoL Esports API
    LOLESPORTS_API_URL: str = "https://esports-api.lolesports.com/persisted/gw"
    LOLESPORTS_FEED_URL: str = "https://feed.lolesports.com/livestats/v1"
    LOLESPORTS_API_KEY: str = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"  # Public API key

    # Data Dragon
    DDRAGON_VERSION: str = "14.6.1"
    DDRAGON_URL: str = f"https://ddragon.leagueoflegends.com/cdn/{DDRAGON_VERSION}"

    # Paths
    CLIPS_DIR: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), "clips")
    THUMBNAILS_DIR: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), "thumbnails")


config = Config()
