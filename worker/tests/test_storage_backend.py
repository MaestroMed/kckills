"""Tests for the storage backend abstraction.

Covers :
  * StorageBackend protocol shape — every concrete class satisfies it
  * KeyLayout — every kind of artefact maps to the right key
  * storage_factory — env var selects the right backend, cached
  * S3StorageBackend — public_url, head, upload all delegate to a mock
    boto3 client correctly
  * GCSStorageBackend — instantiation works, public_url is pure, every
    other method raises NotImplementedError
  * r2_client.py public functions — upload_clip / upload_versioned /
    upload_og delegate to the active backend with the correct keys

ZERO real network calls — boto3 is mocked end-to-end.
"""

from __future__ import annotations

import asyncio
import io
import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# Add worker root to path so "from services import ..." works
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services import storage_factory
from services.storage_backend import (
    KeyLayout,
    StorageBackend,
    key_layout,
)


# ─── Reset the factory cache between tests ──────────────────────────────


@pytest.fixture(autouse=True)
def _reset_storage_cache():
    """Drop the cached backend before AND after each test so env-var
    changes from monkeypatch always take effect."""
    storage_factory.reset_backend_cache()
    yield
    storage_factory.reset_backend_cache()


# ─── 1. KeyLayout helpers ───────────────────────────────────────────────


class TestKeyLayout:
    def test_legacy_clip_horizontal(self):
        kl = KeyLayout()
        assert kl.clip("kill-abc", "h") == "clips/kill-abc_h.mp4"

    def test_legacy_clip_vertical(self):
        kl = KeyLayout()
        assert kl.clip("kill-abc", "v") == "clips/kill-abc_v.mp4"

    def test_legacy_clip_vertical_low(self):
        """vl maps to the historic 'v_low' suffix on disk."""
        kl = KeyLayout()
        assert kl.clip("kill-abc", "vl") == "clips/kill-abc_v_low.mp4"

    def test_legacy_clip_thumbnail(self):
        """Thumbnails live under the thumbnails/ folder, not clips/."""
        kl = KeyLayout()
        assert kl.clip("kill-abc", "thumb") == "thumbnails/kill-abc_thumb.jpg"

    def test_versioned_clip_path(self):
        """game_id present → versioned clips/{game}/{kill}/v{N}/{file}."""
        kl = KeyLayout()
        assert (
            kl.clip("kill-abc", "h", version=2, game_id="game-xyz")
            == "clips/game-xyz/kill-abc/v2/h.mp4"
        )
        assert (
            kl.clip("kill-abc", "vl", version=1, game_id="game-xyz")
            == "clips/game-xyz/kill-abc/v1/v_low.mp4"
        )
        assert (
            kl.clip("kill-abc", "thumb", version=1, game_id="game-xyz")
            == "clips/game-xyz/kill-abc/v1/thumb.jpg"
        )

    def test_og_key(self):
        assert key_layout.og("kill-123") == "og/kill-123.png"

    def test_moment_keys(self):
        kl = KeyLayout()
        assert kl.moment("mom-1", "h") == "moments/mom-1_h.mp4"
        assert kl.moment("mom-1", "vl") == "moments/mom-1_v_low.mp4"
        assert kl.moment("mom-1", "thumb") == "moment_thumbs/mom-1_thumb.jpg"

    def test_hls_keys(self):
        kl = KeyLayout()
        assert kl.hls_master("kill-1") == "hls/kill-1/master.m3u8"
        assert kl.hls_segment("kill-1", 0, 7) == "hls/kill-1/v0_00007.ts"

    def test_clip_unknown_kind_raises(self):
        kl = KeyLayout()
        with pytest.raises(ValueError, match="unknown clip kind"):
            kl.clip("kill", "weird")  # type: ignore[arg-type]


# ─── 2. Factory selection ───────────────────────────────────────────────


class TestStorageFactory:
    def test_default_backend_is_r2(self, monkeypatch: pytest.MonkeyPatch):
        """Unset env → R2 backend, instantiation must succeed."""
        monkeypatch.delenv(storage_factory.ENV_VAR, raising=False)
        # Provide minimal R2 env so the factory's "configured?" log
        # message stays sane (the backend itself works regardless).
        monkeypatch.setenv("R2_ACCOUNT_ID", "fake-account")
        monkeypatch.setenv("R2_ACCESS_KEY_ID", "fake-key")
        monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "fake-secret")
        monkeypatch.setenv("R2_PUBLIC_URL", "https://clips.kckills.com")
        monkeypatch.setenv("R2_BUCKET_NAME", "loltok-clips")

        from services.storage_s3 import S3StorageBackend

        backend = storage_factory.get_storage_backend()
        assert isinstance(backend, S3StorageBackend)
        # Public URL prefix must propagate from R2_PUBLIC_URL
        assert backend.public_url("og/x.png") == "https://clips.kckills.com/og/x.png"

    def test_explicit_r2_backend(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv(storage_factory.ENV_VAR, "r2")
        monkeypatch.setenv("R2_ACCOUNT_ID", "id")
        monkeypatch.setenv("R2_ACCESS_KEY_ID", "k")
        monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "s")
        from services.storage_s3 import S3StorageBackend
        assert isinstance(storage_factory.get_storage_backend(), S3StorageBackend)

    def test_s3_backend(self, monkeypatch: pytest.MonkeyPatch):
        """KCKILLS_STORAGE_BACKEND=s3 → generic S3 with KCKILLS_S3_* vars."""
        monkeypatch.setenv(storage_factory.ENV_VAR, "s3")
        monkeypatch.setenv("KCKILLS_S3_BUCKET", "my-prod-bucket")
        monkeypatch.setenv("KCKILLS_S3_PUBLIC_URL", "https://cdn.example.com")

        from services.storage_s3 import S3StorageBackend

        backend = storage_factory.get_storage_backend()
        assert isinstance(backend, S3StorageBackend)
        assert backend.public_url("og/x.png") == "https://cdn.example.com/og/x.png"

    def test_gcs_backend_stub(self, monkeypatch: pytest.MonkeyPatch):
        """KCKILLS_STORAGE_BACKEND=gcs → GCS stub instantiates but uploads raise."""
        monkeypatch.setenv(storage_factory.ENV_VAR, "gcs")
        monkeypatch.setenv("KCKILLS_GCS_BUCKET", "gcs-bucket")

        from services.storage_gcs import GCSStorageBackend

        backend = storage_factory.get_storage_backend()
        assert isinstance(backend, GCSStorageBackend)
        # public_url is pure → safe to call
        assert (
            backend.public_url("og/k.png")
            == "https://storage.googleapis.com/gcs-bucket/og/k.png"
        )
        # Any actual transfer raises
        with pytest.raises(NotImplementedError):
            backend.upload("k", b"x", content_type="text/plain")
        with pytest.raises(NotImplementedError):
            backend.upload_file("k", "/tmp/x", content_type="text/plain")
        with pytest.raises(NotImplementedError):
            backend.delete("k")
        with pytest.raises(NotImplementedError):
            backend.exists("k")
        with pytest.raises(NotImplementedError):
            backend.head("k")

    def test_unknown_backend_falls_back(self, monkeypatch: pytest.MonkeyPatch):
        """Bogus env → fall back to default (R2) without crashing."""
        monkeypatch.setenv(storage_factory.ENV_VAR, "azure-or-something")
        monkeypatch.setenv("R2_ACCOUNT_ID", "id")
        from services.storage_s3 import S3StorageBackend
        assert isinstance(storage_factory.get_storage_backend(), S3StorageBackend)

    def test_factory_caches_singleton(self, monkeypatch: pytest.MonkeyPatch):
        """Two calls return the same instance — boto3 clients are heavy."""
        monkeypatch.setenv(storage_factory.ENV_VAR, "r2")
        monkeypatch.setenv("R2_ACCOUNT_ID", "id")
        a = storage_factory.get_storage_backend()
        b = storage_factory.get_storage_backend()
        assert a is b

    def test_reset_cache(self, monkeypatch: pytest.MonkeyPatch):
        """reset_backend_cache lets us swap backends mid-process."""
        monkeypatch.setenv(storage_factory.ENV_VAR, "r2")
        monkeypatch.setenv("R2_ACCOUNT_ID", "id")
        a = storage_factory.get_storage_backend()
        storage_factory.reset_backend_cache()
        monkeypatch.setenv(storage_factory.ENV_VAR, "gcs")
        monkeypatch.setenv("KCKILLS_GCS_BUCKET", "gcs")
        b = storage_factory.get_storage_backend()
        assert a is not b
        from services.storage_gcs import GCSStorageBackend
        assert isinstance(b, GCSStorageBackend)


# ─── 3. S3StorageBackend with mocked boto3 ──────────────────────────────


class _FakeBoto3Module:
    """Mimics enough of boto3 for the S3 backend to function without real IO."""

    def __init__(self, mock_client: MagicMock):
        self._mock_client = mock_client

    def client(self, *args: Any, **kwargs: Any) -> MagicMock:
        return self._mock_client


class _FakeBotoConfig:
    """Stand-in for botocore.config.Config — absorbs all kwargs."""

    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = kwargs


def _patch_boto3(mock_client: MagicMock):
    """Patch boto3 + botocore.config.Config inside storage_s3."""
    import services.storage_s3 as mod

    fake_module = _FakeBoto3Module(mock_client)
    boto3_patch = patch.dict(
        sys.modules,
        {"boto3": fake_module, "botocore.config": MagicMock(Config=_FakeBotoConfig)},
    )
    return boto3_patch


class TestS3StorageBackend:
    def _make(self) -> tuple[Any, MagicMock]:
        from services.storage_s3 import S3StorageBackend
        mock_client = MagicMock()
        return (
            S3StorageBackend(
                bucket="test-bucket",
                public_url_prefix="https://cdn.example.com",
                endpoint_url="https://test.endpoint.example.com",
                access_key_id="ak",
                secret_access_key="sk",
            ),
            mock_client,
        )

    def test_satisfies_protocol(self):
        backend, _ = self._make()
        assert isinstance(backend, StorageBackend)

    def test_public_url_uses_prefix(self):
        backend, _ = self._make()
        assert (
            backend.public_url("og/abc.png")
            == "https://cdn.example.com/og/abc.png"
        )

    def test_public_url_falls_back_to_endpoint(self):
        from services.storage_s3 import S3StorageBackend
        b = S3StorageBackend(
            bucket="bk",
            public_url_prefix="",
            endpoint_url="https://endpoint.example.com",
        )
        assert b.public_url("k") == "https://endpoint.example.com/bk/k"

    def test_upload_bytes(self):
        backend, mock_client = self._make()
        with _patch_boto3(mock_client):
            url = backend.upload(
                "og/x.png",
                b"PNGDATA",
                content_type="image/png",
                cache_control="public, max-age=60",
            )
        assert url == "https://cdn.example.com/og/x.png"
        mock_client.put_object.assert_called_once()
        call_kwargs = mock_client.put_object.call_args.kwargs
        assert call_kwargs["Bucket"] == "test-bucket"
        assert call_kwargs["Key"] == "og/x.png"
        assert call_kwargs["Body"] == b"PNGDATA"
        assert call_kwargs["ContentType"] == "image/png"
        assert call_kwargs["CacheControl"] == "public, max-age=60"

    def test_upload_file(self, tmp_path):
        backend, mock_client = self._make()
        local = tmp_path / "x.mp4"
        local.write_bytes(b"video")
        with _patch_boto3(mock_client):
            url = backend.upload_file(
                "clips/k_h.mp4",
                str(local),
                content_type="video/mp4",
                cache_control="public, max-age=31536000, immutable",
            )
        assert url == "https://cdn.example.com/clips/k_h.mp4"
        mock_client.upload_file.assert_called_once()
        kw = mock_client.upload_file.call_args.kwargs
        assert kw["Bucket"] == "test-bucket"
        assert kw["Key"] == "clips/k_h.mp4"
        assert kw["Filename"] == str(local)
        assert kw["ExtraArgs"]["ContentType"] == "video/mp4"
        assert kw["ExtraArgs"]["CacheControl"] == "public, max-age=31536000, immutable"

    def test_upload_file_missing(self):
        backend, mock_client = self._make()
        with _patch_boto3(mock_client):
            with pytest.raises(FileNotFoundError):
                backend.upload_file(
                    "x", "/does/not/exist.mp4", content_type="video/mp4"
                )
        mock_client.upload_file.assert_not_called()

    def test_head_returns_metadata(self):
        from datetime import datetime, timezone
        backend, mock_client = self._make()
        mock_client.head_object.return_value = {
            "ContentLength": 1234,
            "ContentType": "image/png",
            "ETag": '"abc123"',
            "LastModified": datetime(2026, 4, 25, tzinfo=timezone.utc),
        }
        with _patch_boto3(mock_client):
            result = backend.head("og/x.png")
        assert result is not None
        assert result["size"] == 1234
        assert result["content_type"] == "image/png"
        assert result["etag"] == "abc123"
        assert "2026-04-25" in result["last_modified"]

    def test_head_returns_none_for_missing(self):
        backend, mock_client = self._make()
        # Simulate a 404 ClientError
        from botocore.exceptions import ClientError
        err = ClientError(
            {"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject"
        )
        mock_client.head_object.side_effect = err
        with _patch_boto3(mock_client):
            assert backend.head("og/missing.png") is None

    def test_exists_uses_head(self):
        backend, mock_client = self._make()
        mock_client.head_object.return_value = {"ContentLength": 1}
        with _patch_boto3(mock_client):
            assert backend.exists("k") is True

    def test_delete(self):
        backend, mock_client = self._make()
        with _patch_boto3(mock_client):
            backend.delete("og/k.png")
        mock_client.delete_object.assert_called_once_with(
            Bucket="test-bucket", Key="og/k.png"
        )


# ─── 4. r2_client high-level functions delegate correctly ───────────────


class TestR2ClientDelegation:
    """Verify the r2_client.upload_* helpers route to the active backend
    via the right KeyLayout key. We swap the cached backend for a mock
    that records every call."""

    def _install_mock_backend(self) -> MagicMock:
        """Inject a MagicMock as the active backend, return it."""
        mock_backend = MagicMock(spec=StorageBackend)
        # Make the calls return predictable URLs based on the key
        def _public(key: str) -> str:
            return f"https://clips.kckills.com/{key}"
        def _upload_file(key: str, path: str, **_):
            return _public(key)
        mock_backend.public_url.side_effect = _public
        mock_backend.upload_file.side_effect = _upload_file
        mock_backend.upload.side_effect = lambda key, data, **_: _public(key)

        storage_factory.reset_backend_cache()
        storage_factory._backend = mock_backend  # type: ignore[attr-defined]
        return mock_backend

    @pytest.fixture
    def configured_env(self, monkeypatch: pytest.MonkeyPatch):
        """Set the R2 env vars so r2_client._backend_configured() returns True."""
        monkeypatch.setenv("R2_ACCOUNT_ID", "id")
        monkeypatch.setenv("R2_ACCESS_KEY_ID", "k")
        monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "s")
        # Also reset the imported config so it picks up the env
        import config as cfg_module
        import importlib
        importlib.reload(cfg_module)
        # re-import r2_client to refresh its `config` reference
        import services.r2_client as r2c
        importlib.reload(r2c)
        yield
        # Clean up (next test's fixture will re-setup)

    def _run(self, coro):
        return asyncio.run(coro)

    def test_upload_clip_uses_legacy_layout(self, configured_env, tmp_path):
        mock_backend = self._install_mock_backend()
        from services import r2_client
        local = tmp_path / "v.mp4"
        local.write_bytes(b"mp4")

        url = self._run(r2_client.upload_clip("kill-1", str(local), "v"))

        assert url == "https://clips.kckills.com/clips/kill-1_v.mp4"
        mock_backend.upload_file.assert_called_once()
        called_key = mock_backend.upload_file.call_args.args[0]
        assert called_key == "clips/kill-1_v.mp4"
        assert mock_backend.upload_file.call_args.kwargs["content_type"] == "video/mp4"

    def test_upload_clip_thumbnail_legacy_path(self, configured_env, tmp_path):
        mock_backend = self._install_mock_backend()
        from services import r2_client
        local = tmp_path / "t.jpg"
        local.write_bytes(b"jpg")

        url = self._run(r2_client.upload_clip("kill-1", str(local), "thumb"))

        assert url == "https://clips.kckills.com/thumbnails/kill-1_thumb.jpg"
        called_key = mock_backend.upload_file.call_args.args[0]
        assert called_key == "thumbnails/kill-1_thumb.jpg"
        assert mock_backend.upload_file.call_args.kwargs["content_type"] == "image/jpeg"

    def test_upload_clip_v_low_suffix(self, configured_env, tmp_path):
        mock_backend = self._install_mock_backend()
        from services import r2_client
        local = tmp_path / "vl.mp4"
        local.write_bytes(b"mp4")

        url = self._run(r2_client.upload_clip("kill-1", str(local), "v_low"))

        assert "clips/kill-1_v_low.mp4" in url
        called_key = mock_backend.upload_file.call_args.args[0]
        assert called_key == "clips/kill-1_v_low.mp4"

    def test_upload_versioned_key(self, configured_env, tmp_path):
        mock_backend = self._install_mock_backend()
        from services import r2_client
        local = tmp_path / "h.mp4"
        local.write_bytes(b"mp4")

        url = self._run(r2_client.upload_versioned(
            "game-x", "kill-y", 3, str(local), "horizontal"
        ))
        assert url == "https://clips.kckills.com/clips/game-x/kill-y/v3/h.mp4"
        called_key = mock_backend.upload_file.call_args.args[0]
        assert called_key == "clips/game-x/kill-y/v3/h.mp4"

    def test_upload_og_uses_og_prefix_and_short_cache(self, configured_env, tmp_path):
        mock_backend = self._install_mock_backend()
        from services import r2_client
        local = tmp_path / "og.png"
        local.write_bytes(b"png")

        url = self._run(r2_client.upload_og("kill-z", str(local)))
        assert url == "https://clips.kckills.com/og/kill-z.png"
        called_key = mock_backend.upload_file.call_args.args[0]
        assert called_key == "og/kill-z.png"
        assert mock_backend.upload_file.call_args.kwargs["content_type"] == "image/png"
        assert (
            mock_backend.upload_file.call_args.kwargs["cache_control"]
            == "public, max-age=2592000"
        )

    def test_upload_moment_uses_moment_layout(self, configured_env, tmp_path):
        mock_backend = self._install_mock_backend()
        from services import r2_client
        local = tmp_path / "h.mp4"
        local.write_bytes(b"mp4")

        url = self._run(r2_client.upload_moment("mom-1", str(local), "v_low"))
        assert url == "https://clips.kckills.com/moments/mom-1_v_low.mp4"

    def test_upload_no_file_returns_none(self, configured_env):
        self._install_mock_backend()
        from services import r2_client
        url = self._run(
            r2_client.upload("/does/not/exist.mp4", "k", "video/mp4")
        )
        assert url is None

    def test_upload_when_not_configured_returns_none(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path
    ):
        """Empty R2 creds → upload returns None without touching the backend."""
        monkeypatch.setenv("R2_ACCOUNT_ID", "")
        monkeypatch.setenv("R2_ACCESS_KEY_ID", "")
        monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "")
        import config as cfg_module
        import importlib
        importlib.reload(cfg_module)
        import services.r2_client as r2c
        importlib.reload(r2c)
        mock_backend = self._install_mock_backend()

        local = tmp_path / "x.mp4"
        local.write_bytes(b"mp4")
        url = self._run(r2c.upload(str(local), "k", "video/mp4"))
        assert url is None
        mock_backend.upload_file.assert_not_called()

    def test_versioned_key_helper(self):
        """The legacy helper still works and matches KeyLayout output."""
        # Reset imports so we're not poisoned by previous test reloads
        import importlib
        import services.r2_client as r2c
        importlib.reload(r2c)
        assert (
            r2c.versioned_key("g", "k", 1, "horizontal")
            == "clips/g/k/v1/h.mp4"
        )
        assert (
            r2c.versioned_key("g", "k", 2, "vertical_low")
            == "clips/g/k/v2/v_low.mp4"
        )
        assert (
            r2c.versioned_key("g", "k", 1, "thumbnail")
            == "clips/g/k/v1/thumb.jpg"
        )
        with pytest.raises(ValueError):
            r2c.versioned_key("g", "k", 1, "weird-type")

    def test_asset_type_meta_unchanged(self):
        """The ASSET_TYPE_META dict the clipper imports must keep its keys."""
        import importlib
        import services.r2_client as r2c
        importlib.reload(r2c)
        for key in (
            "horizontal", "vertical", "vertical_low", "thumbnail",
            "hls_master", "og_image", "preview_gif",
        ):
            assert key in r2c.ASSET_TYPE_META
            entry = r2c.ASSET_TYPE_META[key]
            assert "file" in entry
            assert "content_type" in entry
            assert "db_type" in entry


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
