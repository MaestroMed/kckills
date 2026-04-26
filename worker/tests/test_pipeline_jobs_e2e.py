"""
End-to-end smoke test for the pipeline_jobs queue (migration 024-025).

Exercises the live wiring : enqueue → claim → succeed/fail → DLQ.
Marked `integration` so the unit-test CI run can skip it.

Skipped automatically if migration 024 isn't applied (verifier returns
non-zero), so a fresh dev DB doesn't fail this test before migrations
run.

Each test uses a unique payload prefix so cleanup can find / drop only
its rows even if the test crashes mid-flight on a previous run.

Why no orchestrator
───────────────────
The supervised orchestrator polls every few seconds and would race the
test : claim our row before the test calls claim(), or move it through
status before assertions can read it. We talk directly to the queue
APIs ; the orchestrator stays out.
"""

from __future__ import annotations

import os
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from dotenv import load_dotenv

_WORKER_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_WORKER_ROOT))
load_dotenv(_WORKER_ROOT / ".env")


# ─── Skip-gate : migration 024 must be applied ──────────────────────

def _migration_024_applied() -> bool:
    """Quick check : does pipeline_jobs exist + does the RPC exist?

    We don't import verify_migrations to avoid a circular dep — just
    re-do the two crucial probes inline.
    """
    try:
        from services.supabase_client import get_db  # noqa: WPS433
    except Exception:
        return False
    db = get_db()
    if db is None:
        return False
    try:
        client = db._get_client()
        # Table reachable?
        r = client.get(
            f"{db.base}/pipeline_jobs",
            params={"select": "id", "limit": "1"},
        )
        if r.status_code != 200:
            return False
        # RPC reachable? Calling with a guaranteed-empty types[] array
        # returns [] on success, 4xx if missing.
        r = client.post(
            f"{db.base}/rpc/fn_claim_pipeline_jobs",
            json={
                "p_worker_id": "test-skip-probe",
                "p_types": ["__nonexistent_type_for_probe__"],
                "p_batch_size": 1,
                "p_lease_seconds": 5,
            },
        )
        return r.status_code in (200, 204)
    except Exception:
        return False


pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not _migration_024_applied(),
        reason="migrations not applied (pipeline_jobs / fn_claim_pipeline_jobs missing)",
    ),
]


# ─── Test fixtures ──────────────────────────────────────────────────

#: Unique-per-process suffix lets parallel test runs coexist + makes
#: cleanup precise.
RUN_TAG = f"e2e-{uuid.uuid4().hex[:8]}"

#: Job type we'll use for every test. clip.create is a real, accepted
#: type per the migration 024 CHECK enum, so we don't have to ALTER
#: the constraint.
JOB_TYPE = "clip.create"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


@pytest.fixture
def tagged_payload():
    """Returns a function that produces uniquely-tagged payloads.

    Tagging by run_tag + per-test counter so cleanup can locate every
    row this test created, including ones that ended up in
    dead_letter_jobs.
    """
    counter = {"n": 0}

    def _make(extra: dict | None = None) -> dict:
        counter["n"] += 1
        body = {
            "run_tag": RUN_TAG,
            "test_seq": counter["n"],
            "created_at_test": _now_utc().isoformat(),
        }
        if extra:
            body.update(extra)
        return body

    return _make


@pytest.fixture(autouse=True)
def cleanup_after_test():
    """Delete every pipeline_jobs / dead_letter_jobs row this run created.

    Runs after each test even if the test errored. Idempotent — if
    nothing matches, the DELETE is a no-op.
    """
    yield
    try:
        from services.supabase_client import get_db
        db = get_db()
        if db is None:
            return
        client = db._get_client()
        # PostgREST filter for jsonb : payload->>run_tag eq RUN_TAG
        params_jobs = {"payload->>run_tag": f"eq.{RUN_TAG}"}
        params_dlq = {"payload->>run_tag": f"eq.{RUN_TAG}"}
        client.delete(
            f"{db.base}/dead_letter_jobs",
            params=params_dlq,
            headers={**db.headers, "Prefer": "return=minimal"},
        )
        client.delete(
            f"{db.base}/pipeline_jobs",
            params=params_jobs,
            headers={**db.headers, "Prefer": "return=minimal"},
        )
        # Same for any pipeline_runs we'd written (we don't insert any
        # here, but defensive).
    except Exception as e:
        print(f"[cleanup] ignored : {e}")


def _fetch_job(job_id: str) -> dict | None:
    """Read a row from pipeline_jobs by id."""
    from services.supabase_client import get_db
    db = get_db()
    assert db is not None
    client = db._get_client()
    r = client.get(
        f"{db.base}/pipeline_jobs",
        params={
            "select": "*",
            "id": f"eq.{job_id}",
        },
    )
    r.raise_for_status()
    rows = r.json() or []
    return rows[0] if rows else None


def _fetch_dlq_for(original_job_id: str) -> list[dict]:
    from services.supabase_client import get_db
    db = get_db()
    assert db is not None
    client = db._get_client()
    r = client.get(
        f"{db.base}/dead_letter_jobs",
        params={
            "select": "*",
            "original_job_id": f"eq.{original_job_id}",
        },
    )
    r.raise_for_status()
    return r.json() or []


# ════════════════════════════════════════════════════════════════════
# TESTS
# ════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_enqueue_returns_uuid(tagged_payload):
    """enqueue() persists a row and returns its UUID."""
    from services import job_queue
    entity_id = f"kill-{RUN_TAG}-enqueue"
    job_id = job_queue.enqueue(
        job_type=JOB_TYPE,
        entity_type="kill",
        entity_id=entity_id,
        payload=tagged_payload({"step": "enqueue"}),
        priority=50,
        max_attempts=3,
    )
    assert job_id is not None, "enqueue should return a UUID"
    # UUID v4 is 36 chars with dashes ; loose check.
    assert len(job_id) == 36 and job_id.count("-") == 4
    row = _fetch_job(job_id)
    assert row is not None, "row must be readable after enqueue"
    assert row["status"] == "pending"
    assert row["type"] == JOB_TYPE
    assert row["entity_id"] == entity_id
    assert row["attempts"] == 0
    assert row["payload"]["run_tag"] == RUN_TAG


@pytest.mark.asyncio
async def test_claim_then_succeed_full_path(tagged_payload):
    """Happy path : enqueue → claim → succeed → check pipeline_runs."""
    from services import job_queue
    from services.supabase_client import get_db

    entity_id = f"kill-{RUN_TAG}-happy"
    job_id = job_queue.enqueue(
        job_type=JOB_TYPE,
        entity_type="kill",
        entity_id=entity_id,
        payload=tagged_payload({"step": "claim_then_succeed"}),
    )
    assert job_id is not None

    # Claim
    claimed = job_queue.claim(
        worker_id="test-e2e",
        job_types=[JOB_TYPE],
        batch_size=5,
        lease_seconds=120,
    )
    # The claim batch may include other queued rows (worker isn't
    # process-isolated). Filter to ours.
    mine = [j for j in claimed if j["id"] == job_id]
    assert mine, (
        f"expected to claim {job_id} but got "
        f"{[j['id'] for j in claimed]}"
    )
    cj = mine[0]
    assert cj["status"] == "claimed"
    assert cj["locked_by"] == "test-e2e"
    assert cj["attempts"] == 1, "claim bumps attempts"

    locked_until = datetime.fromisoformat(
        cj["locked_until"].replace("Z", "+00:00")
    )
    # locked_until must be in the future (within ~120s).
    delta = (locked_until - _now_utc()).total_seconds()
    assert delta > 0, f"lease should be in the future, got delta={delta}"
    assert delta <= 121, f"lease too far : {delta}"

    # Re-fetch to confirm persisted state.
    row = _fetch_job(job_id)
    assert row["status"] == "claimed"
    assert row["locked_by"] == "test-e2e"

    # Succeed
    ok = job_queue.succeed(job_id, result={"clip_url": "https://r2.example/x.mp4"})
    assert ok is True

    row = _fetch_job(job_id)
    assert row["status"] == "succeeded"
    assert row["result"] == {"clip_url": "https://r2.example/x.mp4"}
    assert row["finished_at"] is not None, (
        "trg_pipeline_jobs_touch should stamp finished_at on terminal status"
    )

    # ─── pipeline_runs entry — opt-in ─────────────────────────────
    # job_queue.succeed() does NOT itself write to pipeline_runs (that
    # table is for module-level invocations, not per-job). So we insert
    # one to confirm the table is writable + the FK chain is sound.
    db = get_db()
    assert db is not None
    client = db._get_client()
    r = client.post(
        f"{db.base}/pipeline_runs",
        json={
            "module_name": "test_e2e",
            "worker_id": "test-e2e",
            "status": "succeeded",
            "items_scanned": 1,
            "items_processed": 1,
            "items_failed": 0,
            "items_skipped": 0,
            "metadata": {"run_tag": RUN_TAG, "job_id": job_id},
        },
        headers={**db.headers, "Prefer": "return=representation"},
    )
    r.raise_for_status()
    inserted = r.json()
    assert inserted, "pipeline_runs insert should return the row"
    run_row = inserted[0]
    assert run_row["module_name"] == "test_e2e"
    assert run_row["status"] == "succeeded"

    # Cleanup the test pipeline_runs row (cleanup fixture only handles
    # pipeline_jobs + DLQ).
    client.delete(
        f"{db.base}/pipeline_runs",
        params={"id": f"eq.{run_row['id']}"},
        headers={**db.headers, "Prefer": "return=minimal"},
    )


@pytest.mark.asyncio
async def test_fail_with_retry_pushes_back_to_pending(tagged_payload):
    """fail() with attempts < max_attempts re-queues with run_after in
    the future and clears the lock."""
    from services import job_queue

    entity_id = f"kill-{RUN_TAG}-retry"
    job_id = job_queue.enqueue(
        job_type=JOB_TYPE,
        entity_type="kill",
        entity_id=entity_id,
        payload=tagged_payload({"step": "fail_retry"}),
        max_attempts=3,
    )
    assert job_id is not None

    claimed = job_queue.claim(
        worker_id="test-e2e",
        job_types=[JOB_TYPE],
        batch_size=10,
    )
    assert any(j["id"] == job_id for j in claimed)

    before_t = _now_utc()
    ok = job_queue.fail(
        job_id=job_id,
        error_message="transient blip — try again",
        retry_after_seconds=300,
        error_code="test_transient",
    )
    assert ok is True

    row = _fetch_job(job_id)
    # Crucial assertions for the retry path :
    assert row["status"] == "pending", (
        f"after fail with retries left, status should be 'pending', "
        f"got {row['status']}"
    )
    assert row["locked_by"] is None, "lock should be cleared on retry"
    assert row["locked_until"] is None
    assert row["last_error"] == "transient blip — try again"
    # run_after pushed forward
    next_run = datetime.fromisoformat(row["run_after"].replace("Z", "+00:00"))
    assert next_run > before_t, "run_after must be after the fail() call"
    delta = (next_run - before_t).total_seconds()
    assert 290 <= delta <= 310, (
        f"run_after delay should be ~300s, got {delta}"
    )
    # attempts already at 1 (claim bumped it once) — fail() doesn't
    # bump again, the next claim will. Verify here :
    assert row["attempts"] == 1


@pytest.mark.asyncio
async def test_fail_exhausted_lands_in_dead_letter(tagged_payload):
    """Three failures (max_attempts=3) move the job to dead_letter_jobs.

    Each claim bumps attempts. We need to claim+fail 3 times :
      claim #1 -> attempts=1 -> fail (still under 3) -> retry queued
      claim #2 -> attempts=2 -> fail (still under 3) -> retry queued
      claim #3 -> attempts=3 -> fail (== 3, exhausted) -> DLQ + status=failed
    """
    from services import job_queue

    entity_id = f"kill-{RUN_TAG}-exhaust"
    job_id = job_queue.enqueue(
        job_type=JOB_TYPE,
        entity_type="kill",
        entity_id=entity_id,
        payload=tagged_payload({"step": "exhaust"}),
        max_attempts=3,
    )
    assert job_id is not None

    for round_num in range(1, 4):  # 1, 2, 3
        # Make sure the job is actually due now (push run_after backwards
        # if needed). The fail(retry_after_seconds=...) sets it forward,
        # so for the next iteration we need to flip it back.
        from services.supabase_client import get_db
        db = get_db()
        client = db._get_client()
        client.patch(
            f"{db.base}/pipeline_jobs",
            json={"run_after": _now_utc().isoformat()},
            params={"id": f"eq.{job_id}", "status": "eq.pending"},
            headers={**db.headers, "Prefer": "return=minimal"},
        )

        claimed = job_queue.claim(
            worker_id=f"test-e2e-r{round_num}",
            job_types=[JOB_TYPE],
            batch_size=10,
        )
        mine = [j for j in claimed if j["id"] == job_id]
        assert mine, (
            f"round {round_num} : expected to claim our job ({job_id}) ; "
            f"claimed {[j['id'] for j in claimed]}"
        )
        assert mine[0]["attempts"] == round_num, (
            f"round {round_num} : claim should set attempts={round_num}, "
            f"got {mine[0]['attempts']}"
        )

        ok = job_queue.fail(
            job_id=job_id,
            error_message=f"deterministic failure #{round_num}",
            retry_after_seconds=1,  # short so the next loop can claim
            error_code="test_exhaust",
        )
        assert ok is True

        row = _fetch_job(job_id)
        if round_num < 3:
            assert row["status"] == "pending", (
                f"after round {round_num} fail, status should still allow "
                f"retry, got {row['status']}"
            )
        else:
            assert row["status"] == "failed", (
                f"after the exhausting failure, status must be 'failed', "
                f"got {row['status']}"
            )
            assert row["finished_at"] is not None

    # Confirm the DLQ row was created with the right snapshot.
    dlq_rows = _fetch_dlq_for(job_id)
    assert dlq_rows, (
        f"expected at least one dead_letter_jobs row referencing {job_id}"
    )
    dlq = dlq_rows[0]
    assert dlq["original_job_id"] == job_id
    assert dlq["type"] == JOB_TYPE
    assert dlq["entity_type"] == "kill"
    assert dlq["entity_id"] == entity_id
    assert dlq["error_code"] == "test_exhaust"
    assert dlq["attempts"] == 3
    assert dlq["resolution_status"] == "pending"
    assert dlq["payload"]["run_tag"] == RUN_TAG


@pytest.mark.asyncio
async def test_active_unique_constraint_blocks_duplicates(tagged_payload):
    """The unique partial index (type, entity_type, entity_id) WHERE
    status IN ('pending','claimed') means the second enqueue of the
    same active triplet must NOT create a row. enqueue() catches the
    23505 and returns None instead of raising."""
    from services import job_queue

    entity_id = f"kill-{RUN_TAG}-dedup"
    first = job_queue.enqueue(
        job_type=JOB_TYPE,
        entity_type="kill",
        entity_id=entity_id,
        payload=tagged_payload({"step": "dup-1"}),
    )
    assert first is not None

    second = job_queue.enqueue(
        job_type=JOB_TYPE,
        entity_type="kill",
        entity_id=entity_id,
        payload=tagged_payload({"step": "dup-2"}),
    )
    # Migration 024 unique-active index must reject this.
    assert second is None, (
        "duplicate active enqueue should return None (unique constraint), "
        f"got {second}"
    )


# ─── Standalone runner (so the file works without pytest too) ────────

if __name__ == "__main__":
    import asyncio

    if not _migration_024_applied():
        print("SKIP : migrations 024-025 not applied — verify_migrations.py "
              "first.")
        sys.exit(0)

    print(f"Running e2e suite with run_tag={RUN_TAG}")
    print("-" * 60)

    failures: list[str] = []

    def _run(coro_fn, name: str):
        # Synth tagged_payload outside pytest.
        counter = {"n": 0}

        def make(extra=None):
            counter["n"] += 1
            body = {"run_tag": RUN_TAG, "test_seq": counter["n"]}
            if extra:
                body.update(extra)
            return body

        try:
            asyncio.run(coro_fn(make))
            print(f"[OK]   {name}")
        except AssertionError as e:
            failures.append(f"{name} : {e}")
            print(f"[FAIL] {name} : {e}")
        except Exception as e:
            failures.append(f"{name} : {type(e).__name__} {e}")
            print(f"[ERR]  {name} : {type(e).__name__} {e}")

    _run(test_enqueue_returns_uuid, "enqueue_returns_uuid")
    _run(test_claim_then_succeed_full_path, "claim_then_succeed")
    _run(test_fail_with_retry_pushes_back_to_pending, "fail_retry")
    _run(test_fail_exhausted_lands_in_dead_letter, "fail_exhausted_dlq")
    _run(test_active_unique_constraint_blocks_duplicates, "unique_active")

    # Manual cleanup since we bypassed pytest fixtures.
    try:
        from services.supabase_client import get_db
        db = get_db()
        if db is not None:
            client = db._get_client()
            client.delete(
                f"{db.base}/dead_letter_jobs",
                params={"payload->>run_tag": f"eq.{RUN_TAG}"},
                headers={**db.headers, "Prefer": "return=minimal"},
            )
            client.delete(
                f"{db.base}/pipeline_jobs",
                params={"payload->>run_tag": f"eq.{RUN_TAG}"},
                headers={**db.headers, "Prefer": "return=minimal"},
            )
    except Exception as e:
        print(f"[cleanup] ignored : {e}")

    print("-" * 60)
    if failures:
        print(f"FAILED : {len(failures)} of 5 tests")
        sys.exit(1)
    print("All e2e tests passed.")
