"""
ADMIN_JOB_RUNNER — Claim & execute pipeline_jobs of kind 'worker.backfill'.

Why a separate daemon module ?
  job_dispatcher.py *bridges* legacy kills.status → pipeline_jobs (it
  enqueues, never executes). The actual claim+execute path for the
  domain queue lives across the existing modules (clipper claims
  clip.create, analyzer claims clip.analyze, etc.).

  worker.backfill is a META-kind : the admin UI inserts a row that
  asks the worker to shell out to one of the operator scripts. Letting
  the existing modules handle this is wrong (they own a single domain
  each) and inlining shell-execution into job_dispatcher would mix
  two responsibilities. So : dedicated module.

Security — script whitelist
---------------------------
The admin endpoint accepts a `script` name from JSON, which gets
written into pipeline_jobs.payload. If we naively `subprocess.run`
that string, an attacker who compromises ANY admin path (cookie token
leak, audit-bypass) gets RCE on the worker host. The whitelist below
is the ONLY barrier.

    SCRIPT_WHITELIST = {
        "backfill_clip_errors",
        "backfill_stuck_pipeline",
        "recon_videos_now",
    }

Anything else fails the job immediately with error_code="forbidden_script".

Other guardrails :
  * subprocess.run with timeout=600 (10 min) so a runaway script can't
    pin the daemon
  * Args are flattened into argv with str() coercion ; we never pass
    raw shell strings (`shell=False`)
  * stdout/stderr captured + truncated (last 4 KB) into the job's
    `result` JSONB so the operator can debug from /admin/pipeline/jobs

Daemon cadence : 30s. Most backfills complete in well under that
window so there's no point claiming faster ; the lease is 600s so a
slow run still gets renewed via the script's own observability writes.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time
from pathlib import Path

import structlog

from services import job_queue
from services.observability import note, run_logged, worker_id

log = structlog.get_logger()


# ─── Whitelist — the security boundary ─────────────────────────────

SCRIPT_WHITELIST: set[str] = {
    "backfill_clip_errors",
    "backfill_stuck_pipeline",
    "recon_videos_now",
    "dlq_drain",
}

# Per-script flag schema. Each entry maps an arg name (as it arrives in
# payload.args from the admin endpoint) to how it gets serialised onto
# the CLI. Unknown args are dropped (rejected at run-time) so a typoed
# field can't accidentally set a destructive flag on the next script.
#
# Format :
#   "arg_name": ("flag", kind)
#   kind: "bool"  -> emit `flag` only when value is truthy
#         "value" -> emit `flag value` (str-coerced)
SCRIPT_ARG_SCHEMA: dict[str, dict[str, tuple[str, str]]] = {
    "backfill_clip_errors": {
        "dry_run":   ("--dry-run",   "bool"),
        "limit":     ("--limit",     "value"),
        "min_score": ("--min-score", "value"),
    },
    "backfill_stuck_pipeline": {
        "state":     ("--state",     "value"),
        "dry_run":   ("--dry-run",   "bool"),
        "limit":     ("--limit",     "value"),
        "min_score": ("--min-score", "value"),
        "since":     ("--since",     "value"),
    },
    "recon_videos_now": {
        # No CLI flags ; the script takes no args.
    },
    "dlq_drain": {
        "dry_run":     ("--dry-run",     "bool"),
        "type":        ("--type",        "value"),
        "error_code":  ("--error-code",  "value"),
        "since_days":  ("--since-days",  "value"),
        "limit":       ("--limit",       "value"),
    },
}

# Match the lease window in claim() below ; subprocess timeout < lease
# so we always have time to write the failure row before the lease
# expires and another worker reclaims.
SUBPROCESS_TIMEOUT_S = 600    # 10 min
LEASE_SECONDS = 900           # 15 min — wider than subprocess timeout
CLAIM_BATCH = 1               # Backfills are heavy ; one at a time.

# Tail size for stdout/stderr stored in pipeline_jobs.result. Keeps the
# JSONB row small enough not to bloat /admin/pipeline/jobs/[id].
OUTPUT_TAIL_BYTES = 4096


# ─── Internal helpers ──────────────────────────────────────────────


def _build_argv(script: str, args: dict | None) -> list[str] | None:
    """Build the subprocess argv for one whitelisted script.

    Returns None if `script` isn't whitelisted (caller should fail the
    job with `forbidden_script`). Returns the full argv list otherwise.

    Worker root is resolved relative to this file ; `python` is the
    interpreter currently running this module (sys.executable), which
    is the right thing on Windows where `python` may not be on PATH.
    """
    if script not in SCRIPT_WHITELIST:
        return None

    worker_root = Path(__file__).resolve().parent.parent
    script_path = worker_root / "scripts" / f"{script}.py"
    if not script_path.exists():
        # Whitelisted but missing on disk — different failure mode,
        # surfaced separately. Returning None here would conflate it
        # with the security failure. Raise instead.
        raise FileNotFoundError(f"script not found on disk : {script_path}")

    argv: list[str] = [sys.executable, str(script_path)]

    schema = SCRIPT_ARG_SCHEMA.get(script, {})
    args = args or {}
    for name, value in args.items():
        if name not in schema:
            # Unknown arg — log + drop. The script gets called WITHOUT
            # the bogus flag, which is safer than passing it through
            # and risking arg-injection / unexpected behaviour.
            log.warn(
                "admin_job_runner_unknown_arg",
                script=script, arg=name, value=str(value)[:80],
            )
            continue
        flag, kind = schema[name]
        if kind == "bool":
            if value:
                argv.append(flag)
        elif kind == "value":
            argv.append(flag)
            argv.append(str(value))

    return argv


def _tail(text: str | bytes, n: int = OUTPUT_TAIL_BYTES) -> str:
    """Truncate to the last n bytes, decoded as UTF-8 (surrogateescape).

    Worker stdout on Windows is typically cp1252 ; subprocess.run with
    text=True handles that already, but we still cap to bytes here to
    bound the JSONB size predictably.
    """
    if not text:
        return ""
    if isinstance(text, bytes):
        # surrogateescape so a stray byte doesn't crash the decode.
        text = text.decode("utf-8", errors="surrogateescape")
    if len(text) <= n:
        return text
    return "[...truncated...]\n" + text[-n:]


def _run_script_blocking(argv: list[str]) -> dict:
    """Execute the script synchronously, returning a result dict.

    The dict shape is what gets stored into pipeline_jobs.result :
        {
          "exit_code": int,
          "stdout_tail": str,
          "stderr_tail": str,
          "duration_s": float,
          "argv": [...],   # for debug
          "timeout": bool, # True iff we killed it for taking >SUBPROCESS_TIMEOUT_S
        }
    """
    t0 = time.monotonic()
    timeout_hit = False
    stdout = ""
    stderr = ""
    exit_code = -1

    # Inherit env so KCKILLS_* vars + dotenv loaded values stay
    # available. shell=False is the security lock.
    env = dict(os.environ)
    env["KCKILLS_WORKER_ROLE"] = env.get("KCKILLS_WORKER_ROLE", "admin-runner")

    try:
        proc = subprocess.run(  # noqa: S603 — argv is whitelist-built
            argv,
            capture_output=True,
            text=True,
            shell=False,
            env=env,
            timeout=SUBPROCESS_TIMEOUT_S,
        )
        exit_code = proc.returncode
        stdout = proc.stdout or ""
        stderr = proc.stderr or ""
    except subprocess.TimeoutExpired as e:
        timeout_hit = True
        stdout = _tail(e.stdout or "")
        stderr = _tail(e.stderr or "")
        exit_code = -9  # SIGKILL convention

    return {
        "exit_code": exit_code,
        "stdout_tail": _tail(stdout),
        "stderr_tail": _tail(stderr),
        "duration_s": round(time.monotonic() - t0, 2),
        "argv": argv,
        "timeout": timeout_hit,
    }


# ─── Daemon loop ───────────────────────────────────────────────────


async def _process_one_job(job: dict) -> None:
    """Execute one claimed worker.backfill job.

    Marks the row succeeded or failed via the job_queue helpers ; the
    DLQ promotion on attempts >= max_attempts is handled inside fail().
    """
    job_id = job["id"]
    payload = job.get("payload") or {}
    script = (payload.get("script") or "").strip()
    args = payload.get("args") or {}

    log.info(
        "admin_job_runner_claimed",
        job_id=job_id, script=script,
        args_keys=list(args.keys()) if isinstance(args, dict) else "?",
    )

    # 1. Whitelist check — REFUSE before any subprocess machinery spins up.
    if script not in SCRIPT_WHITELIST:
        log.warn(
            "admin_job_runner_forbidden_script",
            job_id=job_id, script=script,
            whitelist=sorted(SCRIPT_WHITELIST),
        )
        await asyncio.to_thread(
            job_queue.fail,
            job_id,
            f"forbidden script '{script}' (not in whitelist)",
            60,
            "forbidden_script",
        )
        return

    # 2. Build argv. FileNotFoundError = whitelisted but missing on disk —
    # treat as a fatal config error, not a security one.
    try:
        argv = _build_argv(script, args)
    except FileNotFoundError as e:
        await asyncio.to_thread(
            job_queue.fail,
            job_id, str(e), 60, "script_missing",
        )
        return

    if argv is None:
        # _build_argv can return None ONLY for non-whitelisted scripts ;
        # we already handled that above. Defence in depth.
        await asyncio.to_thread(
            job_queue.fail,
            job_id, "argv build returned None", 60, "internal_error",
        )
        return

    # 3. Run the script (off the event loop — subprocess.run is blocking).
    # asyncio.to_thread keeps the event loop free during the (potentially
    # 10-minute) shell-out ; the note() bookends record entry/exit so an
    # operator can correlate run_logged elapsed_s with the actual subprocess
    # window even if other tasks log in between.
    log.info("admin_job_runner_exec", job_id=job_id, argv=argv)
    note(shellout_started=script, shellout_job_id=job_id)
    try:
        result = await asyncio.to_thread(_run_script_blocking, argv)
    except Exception as e:
        note(shellout_threw=script, shellout_error=type(e).__name__)
        log.error(
            "admin_job_runner_exec_threw",
            job_id=job_id, error=str(e)[:200],
        )
        await asyncio.to_thread(
            job_queue.fail,
            job_id, f"exec threw : {type(e).__name__}: {e}",
            120, "exec_error",
        )
        return

    # 4. Mark succeeded / failed based on exit code.
    note(
        shellout_finished=script,
        shellout_exit_code=result["exit_code"],
        shellout_duration_s=result["duration_s"],
        shellout_timeout=result["timeout"],
    )
    if result["exit_code"] == 0 and not result["timeout"]:
        await asyncio.to_thread(
            job_queue.succeed, job_id, result,
        )
        log.info(
            "admin_job_runner_done",
            job_id=job_id, script=script,
            duration_s=result["duration_s"],
        )
    else:
        # Truncate the error message so PostgREST + audit views are happy.
        err_tail = result.get("stderr_tail") or ""
        err_short = err_tail[-500:] if err_tail else ""
        code = (
            "timeout" if result["timeout"]
            else f"exit_{result['exit_code']}"
        )
        await asyncio.to_thread(
            job_queue.fail,
            job_id,
            f"script failed (exit={result['exit_code']}, "
            f"timeout={result['timeout']}). stderr tail : {err_short}",
            300,
            code,
        )
        # Even on failure we want the result available for debugging.
        # job_queue.fail() doesn't write `result`, so do it manually.
        await asyncio.to_thread(_attach_result_on_fail, job_id, result)
        log.warn(
            "admin_job_runner_failed",
            job_id=job_id, script=script,
            exit_code=result["exit_code"],
            timeout=result["timeout"],
            duration_s=result["duration_s"],
        )


def _attach_result_on_fail(job_id: str, result: dict) -> None:
    """Store the result dict on a failed/retried job row.

    job_queue.fail() only writes last_error + status + run_after, but
    operators want the full stdout tail for debugging. We PATCH the
    `result` field separately. Best-effort — no-op on failure.
    """
    try:
        from services.supabase_client import get_db
        db = get_db()
        if db is None:
            return
        client = db._get_client()
        client.patch(
            f"{db.base}/pipeline_jobs",
            json={"result": result},
            headers={**db.headers, "Prefer": "return=minimal"},
            params={"id": f"eq.{job_id}"},
        )
    except Exception as e:
        log.warn("admin_job_runner_attach_result_failed",
                 job_id=job_id, error=str(e)[:160])


@run_logged()
async def run() -> int:
    """One pass : claim & execute up to CLAIM_BATCH worker.backfill jobs.

    Daemon caller (main.py) wraps this in supervised_task(), so a crash
    here just means we sleep RESTART_DELAY and try again. Returns the
    number of jobs processed this tick (0 when the queue's empty).
    """
    wid = worker_id()
    try:
        claimed = await asyncio.to_thread(
            job_queue.claim,
            wid,
            ["worker.backfill"],
            CLAIM_BATCH,
            LEASE_SECONDS,
        )
    except Exception as e:
        log.warn("admin_job_runner_claim_threw", error=str(e)[:200])
        return 0

    if not claimed:
        return 0

    log.info("admin_job_runner_batch", count=len(claimed))
    for job in claimed:
        try:
            await _process_one_job(job)
        except Exception as e:
            # Belt-and-braces : never let one job crash take down the
            # whole batch. _process_one_job already handles its own
            # failures, but a bug in that path shouldn't cancel siblings.
            log.error(
                "admin_job_runner_job_threw",
                job_id=job.get("id"), error=str(e)[:200],
            )
            try:
                await asyncio.to_thread(
                    job_queue.fail,
                    job["id"],
                    f"runner crashed : {type(e).__name__}: {e}",
                    120,
                    "runner_crash",
                )
            except Exception:
                pass

    return len(claimed)


__all__ = [
    "run",
    "SCRIPT_WHITELIST",
    "SCRIPT_ARG_SCHEMA",
]
