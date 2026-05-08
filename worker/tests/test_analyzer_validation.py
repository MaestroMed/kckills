"""
test_analyzer_validation.py - Pure-function coverage for
`modules.analyzer.validate_description`.

Wave 20.6 (2026-05-08) - the audit flagged "Tests for clipper.py /
analyzer.py / hls_packager.py (critical-path low coverage)" as a
backlog item. This file covers the description validator that gates
every clip's publication : if it returns False, the kill stays in
'analyzed' status with needs_regen=true and the next analyzer pass
re-tries. A bug here either lets garbage through (publishes broken
clips) or rejects valid descriptions (wastes Gemini quota retrying
fine output).

We test :
  * each branch of the rejection chain (empty / too short / encoding
    artifact / known hallucination / banned phrase)
  * the happy path
  * the boundary at MIN_DESCRIPTION_CHARS

No fixtures, no I/O. Runs in <100 ms.
"""

from __future__ import annotations

import os
import sys

import pytest

# Ensure `modules.*` resolves when running `pytest` from worker/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modules.analyzer import (  # noqa: E402
    MIN_DESCRIPTION_CHARS,
    validate_description,
)


# ─── Empty / wrong-type rejection ─────────────────────────────────────


def test_none_is_rejected():
    ok, reason = validate_description(None)
    assert ok is False
    assert reason == "empty"


def test_empty_string_is_rejected():
    ok, reason = validate_description("")
    assert ok is False
    assert reason == "empty"


def test_non_string_is_rejected():
    # If a future caller mistakenly passes a dict / int the validator
    # must NOT crash — the pipeline depends on this being safe.
    ok, reason = validate_description(123)  # type: ignore[arg-type]
    assert ok is False
    assert reason == "empty"


# ─── Length boundary ──────────────────────────────────────────────────


def test_too_short_is_rejected():
    ok, reason = validate_description("nope")
    assert ok is False
    assert reason.startswith("too_short")
    # The reason carries the actual length so the operator can debug.
    assert "4 < 50" in reason


def test_exactly_min_chars_is_accepted():
    # Boundary : MIN_DESCRIPTION_CHARS exactly should pass.
    text = "a" * MIN_DESCRIPTION_CHARS
    ok, reason = validate_description(text)
    assert ok is True, f"expected accept at boundary, got {reason}"
    assert reason == "ok"


def test_one_under_min_is_rejected():
    text = "a" * (MIN_DESCRIPTION_CHARS - 1)
    ok, reason = validate_description(text)
    assert ok is False
    assert reason.startswith("too_short")


def test_leading_whitespace_does_not_inflate_length():
    # The validator strips ; if a description is 49 visible chars but
    # 51 with leading spaces, it MUST still be rejected.
    text = "  " + "a" * 49
    ok, reason = validate_description(text)
    assert ok is False
    assert reason.startswith("too_short")


# ─── Encoding-artifact rejection (LaTeX, HTML entities, raw escapes) ──


@pytest.mark.parametrize(
    "bad_text, reason_kw",
    [
        # LaTeX dollar sign — Gemini sometimes wraps numbers in $...$
        ("Caliste $1v2$ outplay sur Faker au minute 22 dans la jungle bot", "encoding_artifact"),
        # \text{} block — Gemini hallucinates LaTeX math notation
        (r"Caliste \text{outplay} 1v2 sur Faker au minute 22 dans la jungle", "encoding_artifact"),
        # HTML entity — happens when source string was double-encoded
        ("Yike &eacute;limine la Gwen avec un Vault Breaker chain a 11:00 OK", "encoding_artifact"),
        # Literal `\uXXXX` escape sequence — the model emitted the raw
        # escape text instead of decoding it. Note the double backslash :
        # we want the literal characters \, u, 0, 0, e, 9 in the input
        # text, not Python's parsed `é`.
        ("Canna en top \\u00e9limine Faker avec son ult a 134 HP minute 17 ya", "encoding_artifact"),
        # Stray HTML tag
        ("<br/>Caliste outplay 1v2 sur Faker au minute 22 dans la jungle bot", "encoding_artifact"),
    ],
)
def test_encoding_artifacts_are_rejected(bad_text: str, reason_kw: str):
    ok, reason = validate_description(bad_text)
    assert ok is False, f"expected reject for {bad_text!r}"
    assert reason_kw in reason


# ─── Known hallucination patterns ─────────────────────────────────────


@pytest.mark.parametrize(
    "bad_text",
    [
        # The "lance-tolet" hallucination - made-up spell name
        "Caliste lance son lance-tolet sur Faker pour finir le combat a 11:00",
        # "Essence of TF" - hallucinated item name
        "Yike utilise Essence ofTF pour reset au minute 22 sur le drake",
        # "Kaléidoscope fantôme" - made up
        "Canna pop sa Kaleidoscope fantome a 134 HP pour engage le teamfight",
        # Case-insensitive : KALEIDOSCOPE FANT also rejected
        "CANNA POP KALEIDOSCOPE FANT POUR ENGAGE LE TEAMFIGHT A 11:00 PILE",
    ],
)
def test_known_hallucinations_rejected(bad_text: str):
    ok, reason = validate_description(bad_text)
    assert ok is False, f"expected reject for {bad_text!r}"
    assert reason.startswith("known_hallucination")


# ─── Banned phrases (style guard) ─────────────────────────────────────


@pytest.mark.parametrize(
    "bad_text",
    [
        # "sans aucune aide" - redundant with the structured solo_kill flag
        "Caliste finit Faker sans aucune aide sur le drake a la minute 22 OK",
        "Yike termine la Gwen sans aide a 11:00 sur le river crab du bottom",
        "Canna pique Lillia sans assistance a 134 HP en top vers la minute 17",
        # Case insensitive
        "CALISTE TERMINE FAKER ZERO ASSIST AU MINUTE 22 PILE EN BOT VICTOIRE",
    ],
)
def test_banned_phrases_rejected(bad_text: str):
    ok, reason = validate_description(bad_text)
    assert ok is False, f"expected reject for {bad_text!r}"
    assert reason.startswith("banned_phrase")


# ─── Happy path ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "good_text",
    [
        # Real-shape examples mirroring production output
        "Caliste pique Gwen a 134 HP avec un Vault Breaker chain a 11:00",
        "KC Yike termine la Lillia a 22:30 avec une execution propre au pit",
        "Canna pop Grand Saut sur Faker au minute 17 dans la riviere bleue",
        # Long-form description
        (
            "L'engage de Yike retourne le tempo : pick sur Lillia a 22:30 "
            "puis chain sur Gwen avec Vault Breaker pour secure le drake."
        ),
    ],
)
def test_valid_descriptions_accepted(good_text: str):
    ok, reason = validate_description(good_text)
    assert ok is True, f"expected accept for {good_text!r}, got {reason}"
    assert reason == "ok"


# ─── Order of checks (encoding before hallucination, etc.) ────────────


def test_check_order_encoding_first():
    """If a string contains BOTH an encoding artifact AND a known
    hallucination, encoding should be reported first because it's the
    cheaper-to-fix cause (re-encode the source text, not regen the
    whole prompt)."""
    text = (
        "Caliste $lance-tolet$ sur Faker au minute 22 dans la jungle bot OK"
    )
    ok, reason = validate_description(text)
    assert ok is False
    # Encoding pattern (the $) is checked before hallucination patterns
    assert reason.startswith("encoding_artifact"), (
        f"expected encoding_artifact first, got {reason}"
    )
