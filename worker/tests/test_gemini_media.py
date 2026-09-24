"""Médias Gemini (2026-09-24) : octets inline d'abord, upload Files API
supprimé ensuite, stockage plein qui ne coupe plus Gemini pour la journée,
thinking_level pour la famille Gemini 3."""
from __future__ import annotations

import asyncio
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from services import gemini_client  # noqa: E402


class _Files:
    def __init__(self, state="ACTIVE"):
        self.state = state
        self.uploaded, self.deleted = [], []

    def upload(self, file=None, config=None):
        self.uploaded.append(file)
        return SimpleNamespace(name=f"files/{len(self.uploaded)}")

    def get(self, name=None):
        return SimpleNamespace(state=SimpleNamespace(name=self.state))

    def delete(self, name=None):
        self.deleted.append(name)


def _client(state="ACTIVE"):
    return SimpleNamespace(files=_Files(state))


def _clip(tmp_path, size=2048):
    p = tmp_path / "clip.mp4"
    p.write_bytes(b"\0" * size)
    return str(p)


def test_small_clip_goes_inline_without_upload(tmp_path):
    client = _client()
    part, uploaded = asyncio.run(gemini_client.media_part(client, _clip(tmp_path), "video/mp4"))
    assert uploaded is None and client.files.uploaded == []
    assert part.inline_data.mime_type == "video/mp4" and len(part.inline_data.data) == 2048


def test_big_clip_is_uploaded_then_released(tmp_path, monkeypatch):
    monkeypatch.setattr(gemini_client, "INLINE_MAX_BYTES", 1024)
    client = _client()
    part, uploaded = asyncio.run(gemini_client.media_part(client, _clip(tmp_path), "video/mp4"))
    assert part is uploaded and uploaded.name == "files/1"
    asyncio.run(gemini_client.release_media(client, uploaded))
    assert client.files.deleted == ["files/1"]


def test_upload_never_active_is_cleaned_up(tmp_path, monkeypatch):
    monkeypatch.setattr(gemini_client, "INLINE_MAX_BYTES", 1024)
    client = _client(state="FAILED")
    assert asyncio.run(gemini_client.media_part(client, _clip(tmp_path), "video/mp4")) == (None, None)
    assert client.files.deleted == ["files/1"]


def test_release_media_is_a_noop_on_none_and_never_raises():
    client = _client()
    asyncio.run(gemini_client.release_media(client, None))

    def boom(name=None):
        raise RuntimeError("404")
    client.files.delete = boom
    asyncio.run(gemini_client.release_media(client, SimpleNamespace(name="files/x")))


def test_inline_part_for_images(tmp_path):
    p = tmp_path / "crop.png"
    p.write_bytes(b"\x89PNG....")
    part = asyncio.run(gemini_client.inline_part(str(p), "image/png"))
    assert part.inline_data.mime_type == "image/png"


def test_storage_full_is_not_a_daily_quota(monkeypatch):
    storage = Exception("429 RESOURCE_EXHAUSTED. Quota exceeded for metric: "
                        "generativelanguage.googleapis.com/file_storage_bytes, quotaId FileStorageBytesPerProject")
    assert gemini_client.classify_gemini_error(storage) == "storage"
    assert gemini_client.classify_gemini_error(Exception("429 RESOURCE_EXHAUSTED requests per day")) == "quota"
    assert gemini_client.classify_gemini_error(Exception("503 unavailable")) == "transient"
    tripped = []
    monkeypatch.setattr(gemini_client.scheduler, "exhaust_quota", lambda *a, **k: tripped.append(a))
    assert gemini_client.handle_gemini_exception(storage, where="t") == "storage"
    assert tripped == []


def test_thinking_level_for_gemini_3_flash():
    from google.genai import types
    cfg = gemini_client._build_thinking_config(types, "gemini-3.8-flash", "minimal")
    assert cfg.thinking_level == types.ThinkingLevel.LOW      # 3.8 refuse MINIMAL
    cfg = gemini_client._build_thinking_config(types, "gemini-3.5-flash", "medium")
    assert cfg.thinking_level == types.ThinkingLevel.MEDIUM
    assert gemini_client._build_thinking_config(types, "gemini-3.5-flash-lite", "low") is None
    assert gemini_client._build_thinking_config(types, "gemini-3.8-flash", None) is None
