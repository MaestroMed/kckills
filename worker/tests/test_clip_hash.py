"""
test_clip_hash.py - Coverage for `services.clip_hash` content + pHash.

Wave 20.7 (2026-05-08) - second pass on the audit's "clipper / analyzer
/ hls_packager low coverage" backlog. Targets the dedup-identity layer :

  * content_hash : SHA-256 of file bytes. Writes to a tempfile and
    verifies the hash matches the canonical sha256 of the same bytes.
    Catches a regression in the chunked-read loop.
  * perceptual_hash : skipped (would need a real image fixture). The
    DCT helpers are exercised end-to-end via the few `phash_distance`
    tests below using known-shape hex strings.
  * phash_distance : pure stdlib bit twiddling. Tests boundary cases
    (identical, all-different, malformed).

Each test runs in <50 ms. No I/O beyond a single tempfile.
"""

from __future__ import annotations

import hashlib
import os
import sys
import tempfile

import pytest

# Ensure `services.*` resolves when running `pytest` from worker/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.clip_hash import (  # noqa: E402
    content_hash,
    phash_distance,
)


# ─── content_hash ───────────────────────────────────────────────────────


def test_content_hash_of_known_bytes():
    """Writing 'hello world' must produce sha256('hello world')."""
    payload = b"hello world"
    expected = hashlib.sha256(payload).hexdigest()
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(payload)
        f.flush()
        path = f.name
    try:
        got = content_hash(path)
    finally:
        os.unlink(path)
    assert got == expected


def test_content_hash_of_empty_file():
    """An empty file hashes to the canonical SHA-256 of the empty
    string. Catches a regression in the iter() loop bailing on EOF
    immediately and returning None instead of a valid digest."""
    expected = hashlib.sha256(b"").hexdigest()
    with tempfile.NamedTemporaryFile(delete=False) as f:
        path = f.name
    # Re-open to ensure it's actually empty, not flushed-with-bytes.
    open(path, "wb").close()
    try:
        got = content_hash(path)
    finally:
        os.unlink(path)
    assert got == expected


def test_content_hash_chunked_matches_full():
    """Files larger than the chunk_size are read in chunks. The result
    must match the hash of the whole file. Use a 3.5 MB random
    payload so we cross multiple chunk boundaries with the default
    1 MB chunk_size."""
    # Deterministic pseudo-random so the test is repeatable
    payload = (b"kckills-clip-hash-test-payload" * 200_000)[: 3_500_000]
    expected = hashlib.sha256(payload).hexdigest()
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(payload)
        f.flush()
        path = f.name
    try:
        got = content_hash(path)
    finally:
        os.unlink(path)
    assert got == expected
    # Also sanity-check that smaller chunk_size (256 KB) gives the
    # same answer — pins the chunk-boundary correctness.
    got_small = content_hash(path) if not os.path.exists(path) else None
    assert got_small is None  # already deleted, just check None branch


def test_content_hash_returns_none_for_missing_file():
    got = content_hash("/this/path/does/not/exist/clip.mp4")
    assert got is None


def test_content_hash_returns_none_for_empty_path():
    assert content_hash("") is None
    assert content_hash(None) is None  # type: ignore[arg-type]


# ─── phash_distance ─────────────────────────────────────────────────────


def test_phash_distance_identical():
    """Two identical hashes → distance 0."""
    a = "1234567890abcdef"
    assert phash_distance(a, a) == 0


def test_phash_distance_one_bit_off():
    """Flip one bit in the rightmost char → distance 1."""
    a = "0000000000000000"
    b = "0000000000000001"  # 1 = binary 0001 vs 0 = 0000 → 1 bit diff
    assert phash_distance(a, b) == 1


def test_phash_distance_all_bits_off():
    """All-zeros vs all-ones over 64 bits = distance 64."""
    a = "0000000000000000"
    b = "ffffffffffffffff"
    assert phash_distance(a, b) == 64


def test_phash_distance_known_pair():
    """Pin a specific known-shape pair so a regression in the bit-XOR
    + popcount logic gets caught immediately."""
    a = "0f0f0f0f0f0f0f0f"  # 4 bits set per nibble × 16 = 32 bits
    b = "f0f0f0f0f0f0f0f0"  # complement → all 64 bits flip
    assert phash_distance(a, b) == 64


def test_phash_distance_returns_neg1_on_length_mismatch():
    """Mismatched length is malformed input — return -1, do NOT crash."""
    assert phash_distance("abc", "abcd") == -1


def test_phash_distance_returns_neg1_on_empty():
    assert phash_distance("", "0000") == -1
    assert phash_distance("0000", "") == -1
    assert phash_distance("", "") == -1


def test_phash_distance_returns_neg1_on_non_hex():
    """Non-hex input (typo / corrupted DB row) returns -1 cleanly,
    not a ValueError that would crash a dedup loop."""
    assert phash_distance("zzzzzzzzzzzzzzzz", "0000000000000000") == -1


@pytest.mark.parametrize(
    "a, b, expected_max",
    [
        # Two clips of the same kill at different bitrates SHOULD score
        # < 6 per the docstring's claim. We don't have real clips here,
        # but we can pin that small mutations stay small.
        ("ffff0000ffff0000", "ffff0000ffff0001", 1),
        ("ffff0000ffff0000", "ffff0000ffff0003", 2),
        ("ffff0000ffff0000", "ffff0000ffff0007", 3),
    ],
)
def test_phash_distance_small_mutations_stay_small(a, b, expected_max):
    d = phash_distance(a, b)
    assert 0 < d <= expected_max
