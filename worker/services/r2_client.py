"""Cloudflare R2 upload client — now a thin async facade over a pluggable
``StorageBackend``.

Historical context : every worker module imported ``r2_client`` and called
``upload_clip`` / ``upload_versioned`` / ``upload_og`` / ``upload`` on it.
We're keeping that public surface 100% intact so no consumer needs to
change. Internally each function now :

1. Resolves the active ``StorageBackend`` via
   ``services.storage_factory.get_storage_backend()`` (R2 by default —
   byte-identical to the old behaviour).
2. Computes the canonical key via ``services.storage_backend.key_layout``.
3. Calls the sync backend method via ``asyncio.to_thread`` to avoid
   blocking the worker event loop.
4. Catches and logs any error, returning ``None`` (matches the old
   error semantics — never let the pipeline crash on an upload).

To swap backends, set ``KCKILLS_STORAGE_BACKEND=s3|gcs`` and provide the
relevant credentials. See ``storage_factory.py`` for the env var list.
"""

from __future__ import annotations

import asyncio
import os

import structlog

from config import config
from scheduler import scheduler

from .storage_backend import key_layout
from .storage_factory import get_storage_backend

log = structlog.get_logger()


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


# Mapping from the legacy short suffix ('h','v','v_low','thumb') used by
# upload_clip / upload_moment to the KeyLayout ClipKind ('h','v','vl','thumb').
# Only "v_low" → "vl" is non-trivial.
_SUFFIX_TO_KIND: dict[str, str] = {
    "h":     "h",
    "v":     "v",
    "v_low": "vl",
    "thumb": "thumb",
}


def _backend_configured() -> bool:
    """Return True iff the active backend has the credentials needed to
    actually talk to its storage. Used as the early-exit gate that the
    old code expressed as "if not config.R2_ACCOUNT_ID".
    """
    # The factory always returns SOMETHING — even with missing creds —
    # because backend selection is independent of credential presence.
    # We mirror the original "is R2 configured ?" check here so the
    # warning message stays unchanged for the operator.
    return bool(
        config.R2_ACCOUNT_ID
        and config.R2_ACCESS_KEY_ID
        and config.R2_SECRET_ACCESS_KEY
    )


# ─── Core upload primitive ──────────────────────────────────────────────


async def upload(
    file_path: str,
    key: str,
    content_type: str = "application/octet-stream",
    cache_control: str = "public, max-age=31536000, immutable",
) -> str | None:
    """Upload a file to the active storage backend. Returns public URL or None.

    `cache_control` overrides the default 1-year immutable header — pass
    a shorter value (e.g. "public, max-age=2592000" for 30 days) for
    artefacts that may be rewritten in place under a stable key.
    """
    if not os.path.exists(file_path):
        log.warn("r2_upload_no_file", path=file_path)
        return None
    if not _backend_configured():
        log.warn("r2_not_configured")
        return None

    await scheduler.wait_for("r2")

    backend = get_storage_backend()
    try:
        # boto3 / GCS clients are sync — run off the event loop.
        url = await asyncio.to_thread(
            backend.upload_file,
            key,
            file_path,
            content_type=content_type,
            cache_control=cache_control,
        )
    except Exception as e:
        log.error("r2_upload_failed", key=key, error=str(e))
        return None

    log.info("r2_uploaded", key=key, size=os.path.getsize(file_path))
    return url


# ─── High-level wrappers (public API — preserved verbatim) ──────────────


async def upload_clip(kill_id: str, local_path: str, format_suffix: str) -> str | None:
    """Upload a clip file under the legacy flat layout.

    format_suffix is one of: 'h', 'v', 'v_low', 'thumb'.

    LEGACY flat-key layout — kept for back-compat with the kills.clip_url_*
    columns. New code should call `upload_versioned` which produces
    `clips/{game_id}/{kill_id}/v{N}/{file}` keys and feeds the kill_assets
    table introduced in migration 026.
    """
    kind = _SUFFIX_TO_KIND.get(format_suffix)
    if kind is None:
        log.error("upload_clip_bad_suffix", suffix=format_suffix)
        return None
    key = key_layout.clip(kill_id, kind)  # game_id=None → legacy flat path
    ct = "image/jpeg" if format_suffix == "thumb" else "video/mp4"
    return await upload(local_path, key, ct)


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
    """Upload a moment clip under the moments/ + moment_thumbs/ prefixes.

    format_suffix is one of: 'h', 'v', 'v_low', 'thumb'.
    """
    kind = _SUFFIX_TO_KIND.get(format_suffix)
    if kind is None:
        log.error("upload_moment_bad_suffix", suffix=format_suffix)
        return None
    key = key_layout.moment(moment_id, kind)  # type: ignore[arg-type]
    ct = "image/jpeg" if format_suffix == "thumb" else "video/mp4"
    return await upload(local_path, key, ct)


async def upload_og(kill_id: str, local_path: str) -> str | None:
    """Upload an OG image under ``og/{kill_id}.png``.

    Cache-Control : 30 days (vs the 1-year-immutable default) because
    the OG image bytes can be regenerated in-place under the same key
    when the AI description / score / multi-kill flag changes — see
    modules/og_refresher.py. A 30-day window is long enough that the
    Cloudflare edge cache absorbs the share-card storm of a viral kill
    but short enough that a regen propagates within a month worst-case.
    The og_refresher also bumps `kills.updated_at` which feeds the
    JSON-LD freshness signal in the page metadata, so most consumers
    pick up the new image well before the cache expires.
    """
    return await upload(
        local_path,
        key_layout.og(kill_id),
        "image/png",
        cache_control="public, max-age=2592000",
    )


def ping() -> bool:
    """Quick sanity check : is the active backend reachable + creds valid ?

    Implemented as a HEAD on a key we don't expect to exist — backends
    treat missing keys as ``None`` rather than an error, so the
    distinction we care about is "did the network call complete vs blow
    up". A blow-up means bad creds / wrong endpoint / DNS failure / etc.
    """
    if not _backend_configured():
        return False
    try:
        backend = get_storage_backend()
        # Probe a key that intentionally doesn't exist. ``None`` is a
        # valid result — what we're confirming is that the SDK call
        # round-tripped without raising.
        backend.head("__ping__/does-not-exist")
        return True
    except Exception as e:
        log.warn("r2_ping_failed", error=str(e))
        return False
