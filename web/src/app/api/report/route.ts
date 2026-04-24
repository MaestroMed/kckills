/**
 * POST /api/report — anonymous-friendly report endpoint.
 *
 * Body :
 *   { targetType, targetId, reasonCode, reasonText?, reporterAnonId? }
 *
 * Behaviour :
 *   1. Validate body against allowed enums (mirror the migration 032
 *      CHECK constraints — fail fast at the API layer with a clean
 *      400, don't make Postgres do that work).
 *   2. Resolve auth.user from the cookie session (optional — anon
 *      reports are allowed).
 *   3. If neither reporter_id nor reporter_anon_id is present, mint
 *      a server-side fallback id from the IP hash so the unique
 *      partial index can still rate-limit the row.
 *   4. INSERT into reports.
 *      - On unique-constraint violation (already reported in pending
 *        state) → return 200 OK with {alreadyReported: true} ; the
 *        button locks for the session either way and the user gets a
 *        consistent "Merci, signalé" toast.
 *   5. On a fresh insert AND the target is a kill, enqueue a
 *      `qc.verify` pipeline_jobs row so the worker re-checks the
 *      target. The unique partial index on pipeline_jobs (type,
 *      entity_type, entity_id) WHERE status IN ('pending','claimed')
 *      makes this idempotent — multiple reports for the same kill
 *      collapse into a single QC job.
 *
 * Security :
 *   - RLS allows INSERT from anyone (migration 032). The endpoint is
 *     the only thing that can do anything else with the table — this
 *     is fine because RLS has no public READ policy.
 *   - We never echo back the reporter's auth state to anonymous
 *     callers, so a leaked report ID from a logged-in user can't be
 *     correlated by an attacker who can't see the row.
 *   - Future improvement (per the spec) : per-IP throttle. Today the
 *     rate limit is just the unique index → one *pending* report per
 *     identity token per target.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ─── Validation enums (mirror migration 032) ──────────────────────────

const VALID_TARGET_TYPES = new Set(["kill", "comment", "community_clip"] as const);
type TargetType = "kill" | "comment" | "community_clip";

const VALID_REASON_CODES = new Set([
  "wrong_clip",
  "no_kill_visible",
  "wrong_player",
  "spam",
  "toxic",
  "other",
] as const);

const MAX_REASON_TEXT_LEN = 500;
const MAX_TARGET_ID_LEN = 128;
const MAX_ANON_ID_LEN = 128;

// ─── Helpers ──────────────────────────────────────────────────────────

function readClientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xRealIp = req.headers.get("x-real-ip");
  if (xRealIp) return xRealIp.trim();
  return null;
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

interface PostgrestError {
  code?: string;
  message?: string;
}

function isUniqueViolation(err: PostgrestError | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "23505") return true;
  if (err.message && /duplicate key|unique constraint/i.test(err.message)) return true;
  return false;
}

// ─── Handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Parse + validate
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const targetType = String(b.targetType ?? "");
  if (!VALID_TARGET_TYPES.has(targetType as TargetType)) {
    return NextResponse.json({ error: "Invalid targetType" }, { status: 400 });
  }

  const targetId = String(b.targetId ?? "").trim();
  if (!targetId || targetId.length > MAX_TARGET_ID_LEN) {
    return NextResponse.json({ error: "Invalid targetId" }, { status: 400 });
  }

  const reasonCode = String(b.reasonCode ?? "");
  if (!VALID_REASON_CODES.has(reasonCode as never)) {
    return NextResponse.json({ error: "Invalid reasonCode" }, { status: 400 });
  }

  let reasonText: string | null = null;
  if (typeof b.reasonText === "string") {
    const trimmed = b.reasonText.trim();
    if (trimmed.length > 0) {
      reasonText = trimmed.slice(0, MAX_REASON_TEXT_LEN);
    }
  }

  let reporterAnonIdInput: string | null = null;
  if (typeof b.reporterAnonId === "string") {
    const trimmed = b.reporterAnonId.trim();
    if (trimmed.length > 0 && trimmed.length <= MAX_ANON_ID_LEN) {
      reporterAnonIdInput = trimmed;
    }
  }

  // 2. Auth (optional)
  const sb = await createServerSupabase();
  let userId: string | null = null;
  try {
    const {
      data: { user },
    } = await sb.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    // Silent — anon path is allowed.
    userId = null;
  }

  // 3. Identity token resolution. The unique partial index needs at
  // least one non-null among (reporter_id, reporter_anon_id) to do its
  // rate-limit job. If the client didn't supply an anon id (e.g. they
  // sent the request via a non-browser tool) we synthesise one from
  // the IP hash so we still get the throttle.
  const ip = readClientIp(request);
  const ipHash = ip ? hashIp(ip) : null;
  let reporterAnonId: string | null = reporterAnonIdInput;
  if (!userId && !reporterAnonId) {
    reporterAnonId = ipHash ? `iphash:${ipHash}` : null;
  }

  // 4. INSERT
  const insertRow = {
    target_type: targetType,
    target_id: targetId,
    reporter_id: userId,
    reporter_anon_id: reporterAnonId,
    reporter_ip_hash: ipHash,
    reason_code: reasonCode,
    reason_text: reasonText,
  };

  const { error: insertErr } = await sb.from("reports").insert(insertRow);

  if (insertErr) {
    if (isUniqueViolation(insertErr)) {
      // Already reported in pending state — treat as soft-success.
      return NextResponse.json({ ok: true, alreadyReported: true });
    }
    return NextResponse.json(
      { error: insertErr.message ?? "Insert failed" },
      { status: 500 },
    );
  }

  // 5. Fresh insert → enqueue a qc.verify pipeline_jobs row so the
  //    worker re-checks. Only meaningful for kill targets — comments
  //    are handled by the existing comment-moderation queue, and
  //    community_clips have a separate approval flow.
  if (targetType === "kill") {
    try {
      // Direct INSERT (no job_queue helper exists in the web layer).
      // The unique partial index on (type, entity_type, entity_id)
      // WHERE status IN ('pending','claimed') makes this idempotent —
      // duplicate enqueues silently no-op via 23505.
      const { error: enqueueErr } = await sb.from("pipeline_jobs").insert({
        type: "qc.verify",
        entity_type: "kill",
        entity_id: targetId,
        payload: {
          source: "user_report",
          reason_code: reasonCode,
        },
        priority: 70, // bump above default 50 — user-flagged is high signal
        status: "pending",
      });
      if (enqueueErr && !isUniqueViolation(enqueueErr)) {
        // Log the enqueue failure but don't fail the report — the
        // qc_sampler will catch it on the next cycle anyway because
        // it reads pending report counts directly.
        console.warn("[api/report] qc.verify enqueue failed:", enqueueErr.message);
      }
    } catch (err) {
      console.warn("[api/report] qc.verify enqueue threw:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
