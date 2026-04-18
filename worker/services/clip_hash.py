"""
Clip identity hashing — content_hash (SHA-256) + perceptual_hash (pHash).

Both feed the canonical clip identity defined in ARCHITECTURE.md §3.1.
Computed once per clip, written to `kills.content_hash` /
`kills.perceptual_hash` (added in migration 006).

Why both:
  - content_hash dedups byte-identical clips (re-uploads, pipeline retries).
  - perceptual_hash dedups visually identical clips that differ in encoding
    (the same kill posted by 3 reaction channels at different bitrates).

Zero new dependencies — uses stdlib `hashlib` + Pillow's DCT primitive
that's already installed for the OG generator.
"""

from __future__ import annotations

import hashlib
import os

import structlog
from PIL import Image

log = structlog.get_logger()


# ─── Content hash (cryptographic, byte-exact) ────────────────────────────

def content_hash(file_path: str, chunk_size: int = 1 << 20) -> str | None:
    """Hex-encoded SHA-256 of the file's bytes. Returns None on failure."""
    if not file_path or not os.path.exists(file_path):
        return None
    try:
        h = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(chunk_size), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError as e:
        log.warn("content_hash_io_error", path=file_path, error=str(e))
        return None


# ─── Perceptual hash (DCT-based pHash, 64 bits) ──────────────────────────
# Standard Marr-Hildreth / Zauner pHash on a 32×32 grayscale luminance
# field. We don't pull `imagehash` because the algorithm is small and we
# already have Pillow — keeps the worker dep tree thin.

_PHASH_DOWN = 32   # downscale to 32×32 before DCT
_PHASH_LOW = 8     # keep the top-left 8×8 of the DCT


def perceptual_hash(image_path: str) -> str | None:
    """Returns a 16-char hex pHash of the image. None on failure."""
    if not image_path or not os.path.exists(image_path):
        return None
    try:
        with Image.open(image_path) as img:
            # Convert to grayscale and downscale.
            small = img.convert("L").resize((_PHASH_DOWN, _PHASH_DOWN), Image.Resampling.LANCZOS)
            pixels = list(small.getdata())
    except (OSError, ValueError) as e:
        log.warn("phash_io_error", path=image_path, error=str(e))
        return None

    # Reshape into a 2D matrix (row-major).
    matrix = [pixels[r * _PHASH_DOWN:(r + 1) * _PHASH_DOWN] for r in range(_PHASH_DOWN)]

    # Apply 2D DCT-II (separable: rows then columns).
    dct = _dct_2d(matrix)

    # Take the top-left 8×8 low-frequency block and skip the DC term [0][0]
    # so very dark / very bright images don't trivially collide.
    low_freq = [dct[r][c] for r in range(_PHASH_LOW) for c in range(_PHASH_LOW)]
    low_freq[0] = 0  # zero out DC component

    # Median over the 64 coefficients gives the per-bit threshold.
    sorted_vals = sorted(v for v in low_freq if v != 0)
    if not sorted_vals:
        return None
    median = sorted_vals[len(sorted_vals) // 2]

    bits = "".join("1" if v > median else "0" for v in low_freq)
    # Encode 64 bits as 16 hex chars.
    return f"{int(bits, 2):016x}"


# ─── DCT helpers (small, exact, no numpy) ────────────────────────────────

def _dct_1d(vec: list[float]) -> list[float]:
    """In-place would be faster but this returns a fresh list — easier to audit."""
    import math
    n = len(vec)
    out = [0.0] * n
    for k in range(n):
        s = 0.0
        for i in range(n):
            s += vec[i] * math.cos(math.pi * k * (2 * i + 1) / (2 * n))
        out[k] = s
    return out


def _dct_2d(matrix: list[list[float]]) -> list[list[float]]:
    n = len(matrix)
    # Rows first.
    rows = [_dct_1d(r) for r in matrix]
    # Then columns: transpose, dct each, transpose back.
    cols = [[rows[r][c] for r in range(n)] for c in range(n)]
    cols = [_dct_1d(c) for c in cols]
    return [[cols[c][r] for c in range(n)] for r in range(n)]


# ─── Hamming distance — handy for dedup queries downstream ───────────────

def phash_distance(a: str, b: str) -> int:
    """Bit-distance between two pHashes. Lower = more similar.

    Two clips of the same play typically score < 6 even after re-encoding;
    < 4 is "essentially identical".
    """
    if not a or not b or len(a) != len(b):
        return -1
    try:
        return bin(int(a, 16) ^ int(b, 16)).count("1")
    except ValueError:
        return -1
