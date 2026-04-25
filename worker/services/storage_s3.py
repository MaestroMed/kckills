"""Generic S3 storage backend.

Wraps ``boto3.client('s3')`` against any S3v4-compatible endpoint. This
covers :

* AWS S3 itself (no endpoint override → boto3's default us-east-1)
* Cloudflare R2 (endpoint = ``https://{account_id}.r2.cloudflarestorage.com``)
* Backblaze B2, Wasabi, MinIO, DigitalOcean Spaces — all S3-compatible
* Any future S3-API-compatible service

The R2-flavoured factory in ``storage_factory.py`` just calls this with
the R2 endpoint and credentials pre-filled. No R2-specific code lives here.
"""

from __future__ import annotations

import os
import threading
from datetime import datetime
from typing import Any

import structlog

from .storage_backend import HeadResult, StorageBackend

log = structlog.get_logger()


class S3StorageBackend(StorageBackend):
    """Synchronous S3-compatible storage backend.

    Lazy-initialises a single boto3 client — boto3 clients are thread-safe
    so we share one across the worker. The async wrappers in r2_client run
    every method via ``asyncio.to_thread``, so blocking I/O here is fine.

    Parameters
    ----------
    bucket :
        Bucket name. Required.
    public_url_prefix :
        Custom-domain or CDN prefix for ``public_url`` (e.g.
        ``https://clips.kckills.com``). If empty, falls back to the raw
        endpoint URL (works for dev, useless behind a CDN).
    endpoint_url :
        S3 endpoint. ``None`` → boto3 default (real AWS S3). For R2 pass
        ``https://{account}.r2.cloudflarestorage.com``.
    access_key_id, secret_access_key :
        Credentials. ``None`` → boto3 picks them up from the standard
        AWS env vars / shared credentials file.
    region_name :
        AWS region. R2 uses ``"auto"``. Defaults to ``"auto"`` since most
        S3-compatible services don't care.
    """

    def __init__(
        self,
        *,
        bucket: str,
        public_url_prefix: str = "",
        endpoint_url: str | None = None,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        region_name: str = "auto",
    ) -> None:
        if not bucket:
            raise ValueError("S3StorageBackend: bucket is required")
        self._bucket = bucket
        self._public_url_prefix = (public_url_prefix or "").rstrip("/")
        self._endpoint_url = endpoint_url
        self._access_key_id = access_key_id
        self._secret_access_key = secret_access_key
        self._region_name = region_name
        self._client: Any = None
        self._client_lock = threading.Lock()

    # ─── Lazy client init ───────────────────────────────────────────

    def _get_client(self) -> Any:
        """Return the boto3 S3 client, instantiating on first call.

        Raises ``RuntimeError`` if boto3 isn't installed — every concrete
        upload method catches and turns this into a logged failure so the
        pipeline degrades gracefully (matches the original r2_client
        behaviour).
        """
        if self._client is not None:
            return self._client
        with self._client_lock:
            if self._client is not None:
                return self._client
            try:
                import boto3
                from botocore.config import Config as BotoConfig
            except ImportError as exc:
                raise RuntimeError(
                    "boto3 is required for the S3 storage backend "
                    "but is not installed"
                ) from exc

            kwargs: dict[str, Any] = {
                "service_name": "s3",
                "region_name": self._region_name,
                "config": BotoConfig(
                    signature_version="s3v4",
                    retries={"max_attempts": 3, "mode": "standard"},
                    connect_timeout=10,
                    read_timeout=60,
                ),
            }
            if self._endpoint_url:
                kwargs["endpoint_url"] = self._endpoint_url
            if self._access_key_id:
                kwargs["aws_access_key_id"] = self._access_key_id
            if self._secret_access_key:
                kwargs["aws_secret_access_key"] = self._secret_access_key

            self._client = boto3.client(**kwargs)
            return self._client

    # ─── StorageBackend interface ───────────────────────────────────

    def upload(
        self,
        key: str,
        data: bytes,
        *,
        content_type: str,
        cache_control: str | None = None,
    ) -> str:
        """Upload raw bytes via ``put_object``."""
        client = self._get_client()
        kwargs: dict[str, Any] = {
            "Bucket": self._bucket,
            "Key": key,
            "Body": data,
            "ContentType": content_type,
        }
        if cache_control:
            kwargs["CacheControl"] = cache_control
        client.put_object(**kwargs)
        return self.public_url(key)

    def upload_file(
        self,
        key: str,
        file_path: str,
        *,
        content_type: str,
        cache_control: str | None = None,
    ) -> str:
        """Upload a local file via ``upload_file`` (streams from disk)."""
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"upload_file: missing {file_path}")
        client = self._get_client()
        extra: dict[str, Any] = {"ContentType": content_type}
        if cache_control:
            extra["CacheControl"] = cache_control
        client.upload_file(
            Filename=file_path,
            Bucket=self._bucket,
            Key=key,
            ExtraArgs=extra,
        )
        return self.public_url(key)

    def delete(self, key: str) -> None:
        """Delete an object — S3 ``delete_object`` is idempotent so missing
        keys are fine.
        """
        client = self._get_client()
        client.delete_object(Bucket=self._bucket, Key=key)

    def exists(self, key: str) -> bool:
        """Probe via ``head_object`` — returns True iff the object exists."""
        return self.head(key) is not None

    def public_url(self, key: str) -> str:
        """Compose ``{prefix}/{key}`` (custom domain) or fall back to the
        raw endpoint when no prefix is configured.
        """
        if self._public_url_prefix:
            return f"{self._public_url_prefix}/{key}"
        # Fallback : direct endpoint (dev only — no CDN caching)
        if self._endpoint_url:
            return f"{self._endpoint_url.rstrip('/')}/{self._bucket}/{key}"
        # Real AWS S3 default
        return f"https://{self._bucket}.s3.amazonaws.com/{key}"

    def head(self, key: str) -> HeadResult | None:
        """``head_object`` → metadata dict, or ``None`` for 404."""
        client = self._get_client()
        try:
            from botocore.exceptions import ClientError
        except ImportError:
            ClientError = Exception  # type: ignore[misc,assignment]
        try:
            resp = client.head_object(Bucket=self._bucket, Key=key)
        except ClientError as exc:  # type: ignore[misc]
            # 404 / NoSuchKey → not an error, just absence
            code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey", "NotFound"):
                return None
            raise

        result: HeadResult = {}
        if "ContentLength" in resp:
            result["size"] = int(resp["ContentLength"])
        if "ContentType" in resp:
            result["content_type"] = str(resp["ContentType"])
        if "ETag" in resp:
            result["etag"] = str(resp["ETag"]).strip('"')
        last_modified = resp.get("LastModified")
        if isinstance(last_modified, datetime):
            result["last_modified"] = last_modified.isoformat()
        elif last_modified:
            result["last_modified"] = str(last_modified)
        return result


__all__ = ["S3StorageBackend"]
