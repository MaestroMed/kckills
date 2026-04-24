"""Cloudflare R2 upload client (boto3 S3-compatible).

Uses boto3 directly instead of shelling out to the AWS CLI:
- Cross-platform (no aws executable on Windows PCs)
- Reliable error handling
- No env var leakage between subprocess calls
- Connection pooling
"""

from __future__ import annotations

import asyncio
import os
import threading
import structlog

from config import config
from scheduler import scheduler

log = structlog.get_logger()


_client = None
_client_lock = threading.Lock()


def _get_client():
    """Lazy-init a shared boto3 S3 client targeting the R2 endpoint."""
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is not None:
            return _client
        if not (
            config.R2_ACCOUNT_ID
            and config.R2_ACCESS_KEY_ID
            and config.R2_SECRET_ACCESS_KEY
        ):
            return None
        try:
            import boto3
            from botocore.config import Config as BotoConfig
        except ImportError:
            log.error("boto3_not_installed")
            return None

        endpoint = f"https://{config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
        _client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=config.R2_ACCESS_KEY_ID,
            aws_secret_access_key=config.R2_SECRET_ACCESS_KEY,
            region_name="auto",
            config=BotoConfig(
                signature_version="s3v4",
                retries={"max_attempts": 3, "mode": "standard"},
                connect_timeout=10,
                read_timeout=60,
            ),
        )
        return _client


def _upload_sync(file_path: str, key: str, content_type: str) -> bool:
    client = _get_client()
    if client is None:
        return False
    try:
        client.upload_file(
            Filename=file_path,
            Bucket=config.R2_BUCKET_NAME,
            Key=key,
            ExtraArgs={
                "ContentType": content_type,
                # Public-readable via the custom domain — R2 does not require ACLs,
                # but setting Cache-Control helps CDN behaviour.
                "CacheControl": "public, max-age=31536000, immutable",
            },
        )
        return True
    except Exception as e:
        log.error("r2_upload_failed", key=key, error=str(e))
        return False


async def upload(
    file_path: str,
    key: str,
    content_type: str = "application/octet-stream",
) -> str | None:
    """Upload a file to R2. Returns public URL or None."""
    if not os.path.exists(file_path):
        log.warn("r2_upload_no_file", path=file_path)
        return None
    if not config.R2_ACCOUNT_ID or not config.R2_ACCESS_KEY_ID:
        log.warn("r2_not_configured")
        return None

    await scheduler.wait_for("r2")

    # boto3 is sync — run it in a thread so we don't block the event loop.
    ok = await asyncio.to_thread(_upload_sync, file_path, key, content_type)
    if not ok:
        return None

    public_url = (config.R2_PUBLIC_URL or "").rstrip("/")
    if public_url:
        url = f"{public_url}/{key}"
    else:
        # Fallback: direct R2 URL (not CDN-cached, for dev only)
        url = f"https://{config.R2_BUCKET_NAME}.{config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/{key}"

    log.info("r2_uploaded", key=key, size=os.path.getsize(file_path))
    return url


async def upload_clip(kill_id: str, local_path: str, format_suffix: str) -> str | None:
    """Upload a clip file to R2 under clips/ prefix.

    format_suffix is one of: 'h', 'v', 'v_low', 'thumb'.

    LEGACY flat-key layout — kept for back-compat with the kills.clip_url_*
    columns. New code should call `upload_versioned` which produces
    `clips/{game_id}/{kill_id}/v{N}/{file}` keys and feeds the kill_assets
    table introduced in migration 026.
    """
    ext = "jpg" if format_suffix == "thumb" else "mp4"
    folder = "thumbnails" if format_suffix == "thumb" else "clips"
    key = f"{folder}/{kill_id}_{format_suffix}.{ext}"
    ct = "image/jpeg" if ext == "jpg" else "video/mp4"
    return await upload(local_path, key, ct)


# ─── Asset-type metadata for the versioned layout ───────────────────────
# Single source of truth for the (file, content_type, manifest_type) tuple
# attached to each artefact. Imported by the clipper so we don't drift the
# naming on R2 vs the kill_assets.type enum.
ASSET_TYPE_META: dict[str, dict[str, str]] = {
    # asset_type        file              content_type   db_type
    "horizontal":   {"file": "h.mp4",          "content_type": "video/mp4",   "db_type": "horizontal"},
    "vertical":     {"file": "v.mp4",          "content_type": "video/mp4",   "db_type": "vertical"},
    "vertical_low": {"file": "v_low.mp4",      "content_type": "video/mp4",   "db_type": "vertical_low"},
    "thumbnail":    {"file": "thumb.jpg",      "content_type": "image/jpeg",  "db_type": "thumbnail"},
    "hls_master":   {"file": "hls/master.m3u8","content_type": "application/vnd.apple.mpegurl", "db_type": "hls_master"},
    "og_image":     {"file": "og.png",         "content_type": "image/png",   "db_type": "og_image"},
    "preview_gif":  {"file": "preview.gif",    "content_type": "image/gif",   "db_type": "preview_gif"},
}


def versioned_key(game_id: str, kill_id: str, version: int, asset_type: str) -> str:
    """Compute the canonical R2 key for a versioned kill asset.

    Layout : clips/{game_id}/{kill_id}/v{N}/{file}

    `asset_type` is one of the keys in ASSET_TYPE_META (horizontal, vertical,
    vertical_low, thumbnail, hls_master, og_image, preview_gif).
    """
    meta = ASSET_TYPE_META.get(asset_type)
    if meta is None:
        raise ValueError(f"unknown asset_type: {asset_type}")
    file_name = meta["file"]
    return f"clips/{game_id}/{kill_id}/v{version}/{file_name}"


async def upload_versioned(
    game_id: str,
    kill_id: str,
    version: int,
    file_path: str,
    asset_type: str,
    content_type: str | None = None,
) -> str | None:
    """Upload a kill artefact to a versioned R2 key.

    Layout: ``clips/{game_id}/{kill_id}/v{N}/{file}`` where {file} is one of
    h.mp4, v.mp4, v_low.mp4, thumb.jpg, hls/master.m3u8, og.png, preview.gif
    depending on `asset_type`.

    Returns the public URL on success, None on any failure (missing file,
    R2 not configured, upload error). Always paired with a kill_assets row
    insert by the caller — this function only handles the bytes.
    """
    meta = ASSET_TYPE_META.get(asset_type)
    if meta is None:
        log.error("upload_versioned_unknown_type", asset_type=asset_type)
        return None
    key = versioned_key(game_id, kill_id, version, asset_type)
    ct = content_type or meta["content_type"]
    return await upload(file_path, key, ct)


async def upload_moment(moment_id: str, local_path: str, format_suffix: str) -> str | None:
    """Upload a moment clip to R2 under moments/ prefix.

    format_suffix is one of: 'h', 'v', 'v_low', 'thumb'.
    """
    ext = "jpg" if format_suffix == "thumb" else "mp4"
    folder = "moment_thumbs" if format_suffix == "thumb" else "moments"
    key = f"{folder}/{moment_id}_{format_suffix}.{ext}"
    ct = "image/jpeg" if ext == "jpg" else "video/mp4"
    return await upload(local_path, key, ct)


async def upload_og(kill_id: str, local_path: str) -> str | None:
    """Upload an OG image to R2 under og/ prefix."""
    return await upload(local_path, f"og/{kill_id}.png", "image/png")


def ping() -> bool:
    """Quick sanity check: is R2 reachable and credentials valid?"""
    client = _get_client()
    if client is None:
        return False
    try:
        client.head_bucket(Bucket=config.R2_BUCKET_NAME)
        return True
    except Exception as e:
        log.warn("r2_ping_failed", error=str(e))
        return False
