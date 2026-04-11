"""Cloudflare R2 upload client."""

import os
import subprocess
import structlog
from config import config
from scheduler import scheduler

log = structlog.get_logger()


async def upload(file_path: str, key: str, content_type: str = "application/octet-stream") -> str | None:
    """Upload a file to R2. Returns public URL or None."""
    if not config.R2_ACCOUNT_ID or not config.R2_ACCESS_KEY_ID:
        log.warn("r2_not_configured")
        return None

    await scheduler.wait_for("r2")
    endpoint = f"https://{config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

    try:
        subprocess.run([
            "aws", "s3", "cp", file_path,
            f"s3://{config.R2_BUCKET_NAME}/{key}",
            "--endpoint-url", endpoint,
            "--content-type", content_type,
        ], capture_output=True, timeout=60, env={
            **os.environ,
            "AWS_ACCESS_KEY_ID": config.R2_ACCESS_KEY_ID,
            "AWS_SECRET_ACCESS_KEY": config.R2_SECRET_ACCESS_KEY,
            "AWS_DEFAULT_REGION": "auto",
        })
        url = f"{config.R2_PUBLIC_URL}/{key}"
        log.info("r2_uploaded", key=key)
        return url
    except Exception as e:
        log.error("r2_upload_failed", key=key, error=str(e))
        return None


async def upload_clip(kill_id: str, local_path: str, format_suffix: str) -> str | None:
    """Upload a clip file to R2 under clips/ prefix."""
    ext = "mp4" if format_suffix != "thumb" else "jpg"
    key = f"clips/{kill_id}_{format_suffix}.{ext}"
    ct = "video/mp4" if ext == "mp4" else "image/jpeg"
    return await upload(local_path, key, ct)


async def upload_og(kill_id: str, local_path: str) -> str | None:
    """Upload an OG image to R2 under og/ prefix."""
    return await upload(local_path, f"og/{kill_id}.png", "image/png")
