/**
 * POST /api/admin/moderation/reports/hide-target
 *
 * Body : { targetType, targetId, reportIds: string[] }
 *
 * Hides the underlying target AND closes out the related reports.
 *
 * For target_type='kill' :
 *   - kills.kill_visible = false
 *   - kills.publication_status = 'hidden'   (PR23 split-status)
 *   - kills.pipeline_status      stays as-is — pipeline progression
 *     and visibility are now independent dimensions, hiding doesn't
 *     undo the analyzer's work
 *   - kills.status = 'manual_review'  (legacy back-compat — the trigger
 *     in migration 027 keeps the new dims in sync but only on UPDATE
 *     of `status`. We write both sides explicitly to be deterministic.)
 *
 * For target_type='comment' :
 *   - comments.is_deleted = true
 *   - comments.moderation_status = 'rejected'
 *
 * For target_type='community_clip' :
 *   - community_clips.approved = false
 *
 * Then : marks every report row with status='actioned',
 * action_taken='hide'. Audit trail via logAdminAction with the
 * before/after diff for the target.
 */
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  deriveActorRole,
  logAdminAction,
  requireAdmin,
} from "@/lib/admin/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_TARGET_TYPES = new Set(["kill", "comment", "community_clip"] as const);

export async function POST(request: Request) {
  const adminCheck = await requireAdmin();
  if (!adminCheck.ok) {
    return NextResponse.json({ error: adminCheck.error }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const targetType = String(b.targetType ?? "");
  if (!VALID_TARGET_TYPES.has(targetType as never)) {
    return NextResponse.json({ error: "Invalid targetType" }, { status: 400 });
  }
  const targetId = String(b.targetId ?? "").trim();
  if (!targetId) {
    return NextResponse.json({ error: "targetId required" }, { status: 400 });
  }
  const reportIds = Array.isArray(b.reportIds)
    ? (b.reportIds as unknown[])
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .slice(0, 200)
    : [];

  const sb = await createServerSupabase();
  const actorRole = deriveActorRole(adminCheck);

  // ─── Hide the target ────────────────────────────────────────────────
  let beforeSnapshot: Record<string, unknown> | null = null;
  let afterPatch: Record<string, unknown> = {};

  if (targetType === "kill") {
    // Snapshot for audit
    const { data: before } = await sb
      .from("kills")
      .select("kill_visible, status, publication_status, pipeline_status, qc_status")
      .eq("id", targetId)
      .maybeSingle();
    beforeSnapshot = before ?? null;

    afterPatch = {
      kill_visible: false,
      // Legacy field — keeps old code paths happy.
      status: "manual_review",
      // PR23 split-status fields. We set publication_status explicitly
      // (the trigger only writes it when status changes AND the new
      // dim wasn't explicitly set, so we belt-and-brace it here).
      publication_status: "hidden",
      qc_status: "human_review",
      updated_at: new Date().toISOString(),
    };

    const { error: updateErr } = await sb
      .from("kills")
      .update(afterPatch)
      .eq("id", targetId);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
  } else if (targetType === "comment") {
    const { data: before } = await sb
      .from("comments")
      .select("is_deleted, moderation_status, content")
      .eq("id", targetId)
      .maybeSingle();
    beforeSnapshot = before ?? null;

    afterPatch = {
      is_deleted: true,
      moderation_status: "rejected",
      moderation_reason: "user_reports",
    };

    const { error: updateErr } = await sb
      .from("comments")
      .update(afterPatch)
      .eq("id", targetId);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
  } else {
    // community_clip
    const { data: before } = await sb
      .from("community_clips")
      .select("approved, external_url")
      .eq("id", targetId)
      .maybeSingle();
    beforeSnapshot = before ?? null;

    afterPatch = { approved: false };

    const { error: updateErr } = await sb
      .from("community_clips")
      .update(afterPatch)
      .eq("id", targetId);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
  }

  // ─── Mark reports actioned ─────────────────────────────────────────
  // Always close ALL pending reports for this target — even ones not
  // explicitly listed in reportIds. This prevents drip-by-drip
  // re-triage when more pending reports for the same target exist.
  let actionedCount = 0;
  {
    const { data: actioned, error: rErr } = await sb
      .from("reports")
      .update({
        status: "actioned",
        action_taken: "hide",
        actioned_by: "admin",
        actioned_at: new Date().toISOString(),
      })
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .eq("status", "pending")
      .select("id");
    if (rErr) {
      return NextResponse.json({ error: rErr.message }, { status: 500 });
    }
    actionedCount = (actioned ?? []).length;
  }

  // ─── Audit ──────────────────────────────────────────────────────────
  await logAdminAction({
    action: `${targetType}.hide`,
    entityType: targetType,
    entityId: targetId,
    actorRole,
    request,
    before: beforeSnapshot,
    after: afterPatch,
    notes:
      reportIds.length > 0
        ? `hidden via ${reportIds.length} report(s) ; total actioned=${actionedCount}`
        : `hidden via reports queue ; total actioned=${actionedCount}`,
  });

  return NextResponse.json({
    ok: true,
    actioned: actionedCount,
    explicit_reports: reportIds.length,
  });
}
