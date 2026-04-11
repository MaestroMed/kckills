"""Supabase database client wrapper."""

from supabase import create_client, Client
from .config import config

_client: Client | None = None


def get_db() -> Client:
    global _client
    if _client is None:
        _client = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)
    return _client


def log(level: str, module: str, message: str, metadata: dict | None = None):
    """Insert a worker log entry."""
    try:
        get_db().table("worker_logs").insert({
            "level": level,
            "module": module,
            "message": message,
            "metadata": metadata,
        }).execute()
    except Exception:
        pass  # Don't crash on log failures


def get_state(key: str, default=None):
    """Get a worker state value."""
    try:
        result = get_db().table("worker_state").select("value").eq("key", key).single().execute()
        return result.data["value"] if result.data else default
    except Exception:
        return default


def set_state(key: str, value):
    """Upsert a worker state value."""
    get_db().table("worker_state").upsert({
        "key": key,
        "value": value,
    }).execute()
