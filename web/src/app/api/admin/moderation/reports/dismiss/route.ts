/**
 * POST /api/admin/moderation/reports/dismiss
 *
 * Body : { reportIds: string[] }
 *
 * Marks the given reports as actioned with action_taken='dismiss' so
 * they leave the pending queue without any side effect on the target.
 * Used when the operator decides the reports are bogus / spam-flag.
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
  const reportIds = (body as { reportIds?: unknown }).reportIds;
  if (!Array.isArray(reportIds) || reportIds.length === 0) {
    return NextResponse.json({ error: "reportIds required" }, { status: 400 });
  }
  const ids = reportIds
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .slice(0, 200);
  if (ids.length === 0) {
    return NextResponse.json({ error: "reportIds empty after filtering" }, { status: 400 });
  }

  const sb = await createServerSupabase();
  const { error } = await sb
    .from("reports")
    .update({
      status: "actioned",
      action_taken: "dismiss",
      actioned_by: "admin",
      actioned_at: new Date().toISOString(),
    })
    .in("id", ids)
    .eq("status", "pending"); // don't trample already-actioned rows

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAdminAction({
    action: "report.dismiss",
    entityType: "report",
    actorRole: deriveActorRole(adminCheck),
    request,
    after: { reportIds: ids },
  });

  return NextResponse.json({ ok: true, dismissed: ids.length });
}
