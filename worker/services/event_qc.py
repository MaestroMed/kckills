"""
EVENT_QC — Helpers for ticking QC gates on game_events rows.

Each pipeline module (clipper, clip_qc, analyzer) calls one of these
helpers after its work completes successfully, flipping the matching
boolean column on the canonical game_events row. The is_publishable
GENERATED column then re-evaluates automatically.

Why a helper module instead of inline supabase calls in each module ?
  * One place to evolve the schema (rename a gate, add a new one) and
    every caller picks it up.
  * Idempotent : if the matching game_events row doesn't exist yet
    (event_mapper hasn't caught up), the tick is a silent no-op
    instead of crashing the caller.
  * Lookup-by-kill_id / lookup-by-moment_id semantics centralised here.
    Module callers don't need to know about the soft FK structure.

Module-by-module ownership :
  * clipper.py            -> tick_qc_clip_produced(kill_id) on success
  * clip_qc.py / job_runner._clip_qc_verify -> tick_qc_clip_validated()
                                                + tick_qc_visible(bool)
  * analyzer.py           -> tick_qc_described(kill_id) when description
                              passes validate_description, AND
                              tick_qc_visible(kill_id, gemini_visible_flag)
  * admin /api/admin/qc   -> tick_qc_human_approved(event_id, bool, reason)

All helpers are sync (PostgREST is fast enough at 0.1s) and tolerant of
the row-not-found case. Errors are logged but not raised — QC ticks
should never break the upstream module's main work.
"""

from __future__ import annotations

import structlog

from services.supabase_client import safe_update

log = structlog.get_logger()


def _patch_event_by_kill(kill_id: str, patch: dict) -> bool:
    """Update the game_events row whose kill_id matches. Returns True
    on a successful PATCH, False if the row didn't exist or the call
    failed (logged at warn level).

    safe_update returns True even on 0 rows affected because PostgREST
    treats it as success — so this is best-effort. event_mapper will
    eventually create the row, and the next tick attempt will succeed.
    """
    if not kill_id:
        return False
    try:
        ok = safe_update("game_events", patch, "kill_id", kill_id)
        return bool(ok)
    except Exception as e:
        log.warn("event_qc_patch_kill_failed", kill_id=kill_id[:8], error=str(e)[:120])
        return False


def _patch_event_by_id(event_id: str, patch: dict) -> bool:
    """Update by game_events.id (used by admin / human_approved flips)."""
    if not event_id:
        return False
    try:
        ok = safe_update("game_events", patch, "id", event_id)
        return bool(ok)
    except Exception as e:
        log.warn("event_qc_patch_id_failed", event_id=event_id[:8], error=str(e)[:120])
        return False


def _patch_event_by_moment(moment_id: str, patch: dict) -> bool:
    """Update by moment_id (used by moment-clipper variants)."""
    if not moment_id:
        return False
    try:
        ok = safe_update("game_events", patch, "moment_id", moment_id)
        return bool(ok)
    except Exception as e:
        log.warn("event_qc_patch_moment_failed", moment_id=moment_id[:8], error=str(e)[:120])
        return False


# ─── Hard gates ──────────────────────────────────────────────────────

def tick_qc_clip_produced(kill_id: str) -> bool:
    """Clipper finished. R2 has the clip. Mark gate green."""
    return _patch_event_by_kill(kill_id, {"qc_clip_produced": True})


def tick_qc_clip_validated(kill_id: str) -> bool:
    """clip_qc Gemini said timer drift OK. Mark gate green."""
    return _patch_event_by_kill(kill_id, {"qc_clip_validated": True})


def tick_qc_typed(kill_id: str) -> bool:
    """Event_type confirmed. Usually auto via classify in event_mapper,
    but exposed here in case a downstream module reclassifies.
    """
    return _patch_event_by_kill(kill_id, {"qc_typed": True})


def tick_qc_described(kill_id: str) -> bool:
    """Analyzer's validate_description passed. Mark gate green."""
    return _patch_event_by_kill(kill_id, {"qc_described": True})


# ─── Permissive gates ────────────────────────────────────────────────

def tick_qc_visible(kill_id: str, visible: bool) -> bool:
    """Gemini's kill_visible_on_screen verdict. Pass the bool, not None
    (use clear_qc_visible to revert to "not yet evaluated").
    """
    if visible is None:
        return False
    return _patch_event_by_kill(kill_id, {"qc_visible": bool(visible)})


def tick_qc_human_approved(event_id: str, approved: bool, reason: str | None = None) -> bool:
    """Admin verdict. Pass approved=True/False explicitly — None means
    "no review yet" which is the default state and should not be set
    via this helper.

    When approved=False, also stores the reason in publish_blocked_reason
    so admin UIs can show it next to the rejected event.
    """
    patch: dict = {"qc_human_approved": bool(approved)}
    if approved is False and reason:
        patch["publish_blocked_reason"] = reason[:500]
    elif approved is True:
        # Clear any previous blocked reason on re-approval
        patch["publish_blocked_reason"] = None
    return _patch_event_by_id(event_id, patch)


# ─── Negative ticks (revert / mark failed) ───────────────────────────

def fail_qc_clip_validated(kill_id: str, reason: str | None = None) -> bool:
    """clip_qc Gemini said the timer drifted > 30s. Mark gate red.
    The event drops back to is_publishable=FALSE automatically via
    the GENERATED column.
    """
    return _patch_event_by_kill(kill_id, {"qc_clip_validated": False})


def fail_qc_described(kill_id: str) -> bool:
    """analyze_kill_row's validate_description rejected the description
    (after retries exhausted). Hold the gate red.
    """
    return _patch_event_by_kill(kill_id, {"qc_described": False})
