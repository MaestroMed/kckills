"""Storage backend abstraction.

The worker historically uploaded everything to Cloudflare R2 via
``services.r2_client``. R2 was picked for its zero-egress free tier — perfect
for a 10 GB pilot. Once LoLTok scales beyond that, we'll want to swap to
generic S3 (Backblaze B2, Wasabi), GCS, Azure Blob, or even Cloudflare
Stream for HLS.

This module defines the interface every concrete backend must satisfy and
the canonical key layout (so the on-disk path of a clip is owned in ONE
place — not duplicated between the clipper, the og generator, the pipeline,
and the next backend we add).

Design notes
------------
* The interface is **synchronous**. The async wrappers in ``r2_client.py``
  bridge to ``asyncio.to_thread`` — keeping the backend pure-sync makes it
  trivial to mock in tests and lets each implementation use its native SDK
  (boto3, google-cloud-storage, azure.storage.blob) without forcing every
  caller into asyncio.
* ``public_url`` is part of the interface because each backend computes it
  differently — R2 uses a CNAMEd custom domain, raw S3 uses the bucket
  endpoint, GCS uses ``storage.googleapis.com/{bucket}/{key}``.
* ``head`` returns an opaque ``dict`` (``{size, content_type, etag,
  last_modified}``) or ``None`` if missing. This is enough for the
  og_refresher to skip an upload when the bytes already exist and match.
* ``KeyLayout`` is the SINGLE source of truth for "where does artefact X
  for kill Y land". The legacy flat layout is preserved — new code passes
  ``game_id`` and gets the versioned path.
"""

from __future__ import annotations

from typing import Literal, Protocol, TypedDict, runtime_checkable


# ─── Public types ───────────────────────────────────────────────────────


ClipKind = Literal["h", "v", "vl", "thumb"]
"""Short code for a clip artefact:

* ``h``     — horizontal 16:9 720p MP4
* ``v``     — vertical 9:16 720p MP4
* ``vl``    — vertical 9:16 360p low-bandwidth MP4
* ``thumb`` — 9:16 720p JPEG poster frame
"""


class HeadResult(TypedDict, total=False):
    """Subset of object metadata returned by ``StorageBackend.head``.

    ``total=False`` because not every backend exposes every field — S3
    always has size and last_modified, GCS adds generation, etc. Callers
    should treat extra keys as best-effort.
    """

    size: int
    content_type: str
    etag: str
    last_modified: str  # ISO 8601


# ─── The backend protocol ───────────────────────────────────────────────


@runtime_checkable
class StorageBackend(Protocol):
    """Synchronous storage interface — must be satisfied by every backend.

    Implementations live in ``storage_s3.py`` (generic S3, also used for
    R2 since it speaks S3v4), ``storage_gcs.py`` (GCS stub), and any
    future ``storage_azure.py`` / ``storage_stream.py`` / etc.

    The async wrappers in ``r2_client.py`` call these methods via
    ``asyncio.to_thread`` so the worker event loop never blocks on I/O.
    """

    def upload(
        self,
        key: str,
        data: bytes,
        *,
        content_type: str,
        cache_control: str | None = None,
    ) -> str:
        """Upload raw bytes under ``key``. Returns the public URL.

        Raises on any failure — callers wrap with try/except and convert
        to None for backwards compat with the existing pipeline.
        """
        ...

    def upload_file(
        self,
        key: str,
        file_path: str,
        *,
        content_type: str,
        cache_control: str | None = None,
    ) -> str:
        """Upload a local file. Same return / error semantics as ``upload``.

        Separate method so backends can stream large MP4s instead of
        slurping them into memory.
        """
        ...

    def delete(self, key: str) -> None:
        """Delete the object at ``key``. No-op if it doesn't exist."""
        ...

    def exists(self, key: str) -> bool:
        """True iff an object exists at ``key``."""
        ...

    def public_url(self, key: str) -> str:
        """Compute the canonical public URL for ``key`` without uploading.

        Used when we know the artefact is already there (re-runs, OG
        regen) and we just need the URL to write to Supabase.
        """
        ...

    def head(self, key: str) -> HeadResult | None:
        """Return object metadata, or ``None`` if the key doesn't exist."""
        ...


# ─── Canonical key layout ───────────────────────────────────────────────


class KeyLayout:
    """Computes the on-storage key for every kind of artefact.

    Two layouts coexist for clips :

    1. **Legacy flat** — ``clips/{kill_id}_{kind}.mp4`` and
       ``thumbnails/{kill_id}_thumb.jpg``. Used by the old
       ``kills.clip_url_*`` columns and kept for back-compat. Pass
       ``game_id=None`` to get this layout.
    2. **Versioned** — ``clips/{game_id}/{kill_id}/v{N}/{file}``. New
       code passes ``game_id`` and gets a versioned path that feeds the
       ``kill_assets`` table introduced in migration 026 ; lets us
       re-encode a clip without overwriting the live URL until the new
       version is fully uploaded.

    OG images and HLS use their own dedicated prefixes.
    """

    # Legacy (flat) clip files: extension + folder per kind
    _LEGACY_FLAT: dict[ClipKind, tuple[str, str]] = {
        "h":     ("clips",      "mp4"),
        "v":     ("clips",      "mp4"),
        "vl":    ("clips",      "mp4"),  # historic suffix is "v_low"
        "thumb": ("thumbnails", "jpg"),
    }

    # Versioned files: just the basename inside v{N}/
    _VERSIONED_FILE: dict[ClipKind, str] = {
        "h":     "h.mp4",
        "v":     "v.mp4",
        "vl":    "v_low.mp4",
        "thumb": "thumb.jpg",
    }

    # The legacy suffix is the same as the kind EXCEPT for "vl" → "v_low"
    _LEGACY_SUFFIX: dict[ClipKind, str] = {
        "h":     "h",
        "v":     "v",
        "vl":    "v_low",
        "thumb": "thumb",
    }

    def clip(
        self,
        kill_id: str,
        kind: ClipKind,
        *,
        version: int = 1,
        game_id: str | None = None,
    ) -> str:
        """Canonical key for a clip artefact.

        With ``game_id`` → versioned ``clips/{game_id}/{kill_id}/v{N}/{file}``.
        Without ``game_id`` → legacy flat ``clips/{kill_id}_{suffix}.mp4`` (or
        ``thumbnails/{kill_id}_thumb.jpg`` for the thumbnail).
        """
        if kind not in self._VERSIONED_FILE:
            raise ValueError(
                f"unknown clip kind: {kind!r} "
                f"(expected one of h, v, vl, thumb)"
            )
        if game_id:
            return f"clips/{game_id}/{kill_id}/v{version}/{self._VERSIONED_FILE[kind]}"
        folder, ext = self._LEGACY_FLAT[kind]
        suffix = self._LEGACY_SUFFIX[kind]
        return f"{folder}/{kill_id}_{suffix}.{ext}"

    def og(self, kill_id: str) -> str:
        """OG image lives at ``og/{kill_id}.png`` — bytes can be rewritten
        in place when ai_description / score / multi-kill changes (see
        ``modules/og_refresher.py``).
        """
        return f"og/{kill_id}.png"

    def moment(self, moment_id: str, kind: ClipKind) -> str:
        """Moments (PR-arch P3) use a parallel layout under ``moments/``
        and ``moment_thumbs/`` — same flat scheme as the legacy clip path.
        """
        if kind not in self._VERSIONED_FILE:
            raise ValueError(f"unknown moment clip kind: {kind!r}")
        if kind == "thumb":
            return f"moment_thumbs/{moment_id}_thumb.jpg"
        suffix = self._LEGACY_SUFFIX[kind]
        return f"moments/{moment_id}_{suffix}.mp4"

    def hls_master(self, kill_id: str) -> str:
        """Master playlist for a kill's HLS stream."""
        return f"hls/{kill_id}/master.m3u8"

    def hls_segment(self, kill_id: str, variant: int, segment: int) -> str:
        """Individual ``.ts`` segment in the HLS ladder.

        Layout : ``hls/{kill_id}/v{variant}_{segment:05d}.ts`` — matches
        the ffmpeg ``-hls_segment_filename`` template the packager uses.
        """
        return f"hls/{kill_id}/v{variant}_{segment:05d}.ts"


# Module-level singleton — there's no per-call state in KeyLayout, so a
# shared instance is fine and saves callers from instantiating it.
key_layout = KeyLayout()


__all__ = [
    "ClipKind",
    "HeadResult",
    "KeyLayout",
    "StorageBackend",
    "key_layout",
]
