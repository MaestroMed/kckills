"""Storage backend factory — env-driven selection.

The worker reads ``KCKILLS_STORAGE_BACKEND`` once at module load and
caches the chosen implementation for the rest of the process lifetime.
This means :

* Default deploy (``KCKILLS_STORAGE_BACKEND`` unset or ``r2``) is
  byte-identical to the pre-abstraction behaviour.
* Switching to generic S3 / GCS / future backends is a one-env-var flip
  + the matching credentials. No code change in any module that uploads.
* Tests can call ``reset_backend_cache()`` to swap backends mid-process.

Env vars consumed
-----------------
Common (all backends) :
* ``KCKILLS_STORAGE_BACKEND``   — ``r2`` (default) | ``s3`` | ``gcs``

R2-specific (default backend, names match the existing ``config.R2_*``) :
* ``R2_ACCOUNT_ID``             — Cloudflare account ID
* ``R2_ACCESS_KEY_ID``          — R2 token access key
* ``R2_SECRET_ACCESS_KEY``      — R2 token secret
* ``R2_BUCKET_NAME``            — bucket (default ``loltok-clips``)
* ``R2_PUBLIC_URL``             — CNAMEd custom domain (e.g. ``https://clips.kckills.com``)

Generic S3 (when ``KCKILLS_STORAGE_BACKEND=s3``) :
* ``KCKILLS_S3_BUCKET``         — bucket (required)
* ``KCKILLS_S3_ENDPOINT_URL``   — endpoint, blank for real AWS S3
* ``KCKILLS_S3_ACCESS_KEY_ID``  — credentials, blank to use boto3 chain
* ``KCKILLS_S3_SECRET_ACCESS_KEY``
* ``KCKILLS_S3_REGION``         — region (default ``auto``)
* ``KCKILLS_S3_PUBLIC_URL``     — CDN / custom domain

GCS (when ``KCKILLS_STORAGE_BACKEND=gcs``, currently a stub) :
* ``KCKILLS_GCS_BUCKET``        — bucket (required)
* ``KCKILLS_GCS_PROJECT_ID``    — GCP project
* ``KCKILLS_GCS_CREDENTIALS_PATH`` — path to service-account JSON
* ``KCKILLS_GCS_PUBLIC_URL``    — custom domain
"""

from __future__ import annotations

import os
import threading

import structlog

from .storage_backend import StorageBackend

log = structlog.get_logger()


# Recognised backend identifiers (lower-case, matched case-insensitively).
BACKEND_R2 = "r2"
BACKEND_S3 = "s3"
BACKEND_GCS = "gcs"

ENV_VAR = "KCKILLS_STORAGE_BACKEND"
DEFAULT_BACKEND = BACKEND_R2


_backend: StorageBackend | None = None
_backend_lock = threading.Lock()


def _selected_backend() -> str:
    """Return the lower-cased backend identifier from the env, or the
    default. Unknown values fall back to the default with a warning —
    we don't want a typo in an env var to take the worker offline.
    """
    raw = (os.environ.get(ENV_VAR) or DEFAULT_BACKEND).strip().lower()
    if raw not in (BACKEND_R2, BACKEND_S3, BACKEND_GCS):
        log.warning(
            "storage_backend_unknown",
            requested=raw,
            falling_back_to=DEFAULT_BACKEND,
        )
        return DEFAULT_BACKEND
    return raw


def _build_r2() -> StorageBackend:
    """R2 = generic S3 against the Cloudflare endpoint, with credentials
    from the existing R2_* env vars (kept for back-compat with every
    deploy out there)."""
    # Local import to avoid pulling boto3 into modules that just need
    # KeyLayout (e.g. tests, og generator pre-render).
    from .storage_s3 import S3StorageBackend

    account_id = os.environ.get("R2_ACCOUNT_ID", "")
    access_key = os.environ.get("R2_ACCESS_KEY_ID", "")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    bucket = os.environ.get("R2_BUCKET_NAME", "loltok-clips")
    public_url = os.environ.get("R2_PUBLIC_URL", "")

    endpoint = (
        f"https://{account_id}.r2.cloudflarestorage.com" if account_id else None
    )
    # Default fallback : direct R2 URL (dev only). Matches the original
    # r2_client behaviour when R2_PUBLIC_URL was unset.
    if not public_url and account_id and bucket:
        public_url = f"https://{bucket}.{account_id}.r2.cloudflarestorage.com"

    log.info(
        "storage_backend_init",
        backend=BACKEND_R2,
        bucket=bucket,
        public_url=public_url,
        configured=bool(account_id and access_key and secret_key),
    )
    return S3StorageBackend(
        bucket=bucket,
        public_url_prefix=public_url,
        endpoint_url=endpoint,
        access_key_id=access_key or None,
        secret_access_key=secret_key or None,
        region_name="auto",
    )


def _build_s3() -> StorageBackend:
    """Generic S3 — endpoint optional (defaults to real AWS S3)."""
    from .storage_s3 import S3StorageBackend

    bucket = os.environ.get("KCKILLS_S3_BUCKET", "")
    endpoint = os.environ.get("KCKILLS_S3_ENDPOINT_URL", "") or None
    access_key = os.environ.get("KCKILLS_S3_ACCESS_KEY_ID", "") or None
    secret_key = os.environ.get("KCKILLS_S3_SECRET_ACCESS_KEY", "") or None
    region = os.environ.get("KCKILLS_S3_REGION", "auto")
    public_url = os.environ.get("KCKILLS_S3_PUBLIC_URL", "")

    log.info(
        "storage_backend_init",
        backend=BACKEND_S3,
        bucket=bucket,
        endpoint=endpoint or "<aws-default>",
        public_url=public_url,
    )
    return S3StorageBackend(
        bucket=bucket,
        public_url_prefix=public_url,
        endpoint_url=endpoint,
        access_key_id=access_key,
        secret_access_key=secret_key,
        region_name=region,
    )


def _build_gcs() -> StorageBackend:
    """GCS stub — instantiation works, any upload raises."""
    from .storage_gcs import GCSStorageBackend

    bucket = os.environ.get("KCKILLS_GCS_BUCKET", "")
    project_id = os.environ.get("KCKILLS_GCS_PROJECT_ID") or None
    creds_path = os.environ.get("KCKILLS_GCS_CREDENTIALS_PATH") or None
    public_url = os.environ.get("KCKILLS_GCS_PUBLIC_URL", "")

    log.info(
        "storage_backend_init",
        backend=BACKEND_GCS,
        bucket=bucket,
        public_url=public_url,
        note="stub — uploads will raise NotImplementedError",
    )
    return GCSStorageBackend(
        bucket=bucket,
        public_url_prefix=public_url,
        project_id=project_id,
        credentials_json_path=creds_path,
    )


_BUILDERS = {
    BACKEND_R2:  _build_r2,
    BACKEND_S3:  _build_s3,
    BACKEND_GCS: _build_gcs,
}


def get_storage_backend() -> StorageBackend:
    """Return the worker's storage backend (cached singleton).

    First call instantiates per ``KCKILLS_STORAGE_BACKEND``. Subsequent
    calls return the same instance — boto3 / google-cloud clients are
    expensive to build and cheap to share.
    """
    global _backend
    if _backend is not None:
        return _backend
    with _backend_lock:
        if _backend is not None:
            return _backend
        choice = _selected_backend()
        builder = _BUILDERS[choice]
        _backend = builder()
        return _backend


def reset_backend_cache() -> None:
    """Drop the cached backend so the next ``get_storage_backend`` call
    re-reads the env. Used by tests to swap backends mid-process — not
    intended for production code.
    """
    global _backend
    with _backend_lock:
        _backend = None


__all__ = [
    "BACKEND_GCS",
    "BACKEND_R2",
    "BACKEND_S3",
    "DEFAULT_BACKEND",
    "ENV_VAR",
    "get_storage_backend",
    "reset_backend_cache",
]
