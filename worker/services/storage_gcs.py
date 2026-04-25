"""Google Cloud Storage backend — STUB.

Implements the ``StorageBackend`` interface so the abstraction is provably
generic, but every method that would actually touch GCS raises
``NotImplementedError``. The point is :

1. ``isinstance(backend, StorageBackend)`` works against the GCS class —
   we can swap it in via ``KCKILLS_STORAGE_BACKEND=gcs`` and the rest of
   the codebase compiles fine.
2. The first call that would hit the wire fails loudly with a clear
   message instead of silently corrupting data or hanging.
3. When LoLTok actually needs GCS (multi-region failover, GCP-only
   compliance shop, etc.) the implementation is a drop-in : install
   ``google-cloud-storage``, fill in the methods, ship.

The constructor accepts the same shape of params an eventual real impl
would need (bucket, project_id, credentials_json, public_url_prefix) so
``storage_factory.py`` doesn't change when we wire the real backend up.
"""

from __future__ import annotations

import structlog

from .storage_backend import HeadResult, StorageBackend

log = structlog.get_logger()


_STUB_MESSAGE = (
    "GCS storage backend is a stub — install google-cloud-storage and "
    "implement the methods in worker/services/storage_gcs.py before "
    "setting KCKILLS_STORAGE_BACKEND=gcs in production."
)


class GCSStorageBackend(StorageBackend):
    """Stub GCS implementation — instantiation works, calls explode.

    Constructor params match a future real implementation so the
    factory doesn't need to change when this gets fleshed out.
    """

    def __init__(
        self,
        *,
        bucket: str,
        public_url_prefix: str = "",
        project_id: str | None = None,
        credentials_json_path: str | None = None,
    ) -> None:
        if not bucket:
            raise ValueError("GCSStorageBackend: bucket is required")
        self._bucket = bucket
        self._public_url_prefix = (public_url_prefix or "").rstrip("/")
        self._project_id = project_id
        self._credentials_json_path = credentials_json_path
        log.warning(
            "gcs_backend_stub_instantiated",
            bucket=bucket,
            note="any upload/download will raise NotImplementedError",
        )

    # ─── StorageBackend interface (all raise) ──────────────────────

    def upload(
        self,
        key: str,
        data: bytes,
        *,
        content_type: str,
        cache_control: str | None = None,
    ) -> str:
        raise NotImplementedError(_STUB_MESSAGE)

    def upload_file(
        self,
        key: str,
        file_path: str,
        *,
        content_type: str,
        cache_control: str | None = None,
    ) -> str:
        raise NotImplementedError(_STUB_MESSAGE)

    def delete(self, key: str) -> None:
        raise NotImplementedError(_STUB_MESSAGE)

    def exists(self, key: str) -> bool:
        raise NotImplementedError(_STUB_MESSAGE)

    def public_url(self, key: str) -> str:
        """The URL computation is pure — no network — so we CAN implement
        it cheaply. Useful for the factory smoke test, doesn't need GCS
        creds. Falls back to the official ``storage.googleapis.com`` URL
        when no custom prefix is set.
        """
        if self._public_url_prefix:
            return f"{self._public_url_prefix}/{key}"
        return f"https://storage.googleapis.com/{self._bucket}/{key}"

    def head(self, key: str) -> HeadResult | None:
        raise NotImplementedError(_STUB_MESSAGE)


__all__ = ["GCSStorageBackend"]
