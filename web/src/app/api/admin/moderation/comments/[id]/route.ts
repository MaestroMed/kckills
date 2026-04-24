import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { deriveActorRole, logAdminAction, requireAdmin } from "@/lib/admin/audit";

/** POST /api/admin/moderation/comments/[id]
 *  Body: { action: 'approve'|'reject'|'delete'|'flag', reason?: string } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: 403 });

  const { id } = await params;
  const body = await req.json();
  const action = body.action;

  let patch: Record<string, unknown> = {};
  switch (action) {
    case "approve":
      patch = { moderation_status: "approved", moderation_reason: null };
      break;
    case "reject":
      patch = { moderation_status: "rejected", moderation_reason: body.reason ?? null };
      break;
    case "flag":
      patch = { moderation_status: "flagged", moderation_reason: body.reason ?? null };
      break;
    case "delete":
      patch = { is_deleted: true };
      break;
    default:
      return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
  }

  const sb = await createServerSupabase();
  const { data: before } = await sb.from("comments").select("moderation_status,is_deleted,content").eq("id", id).single();
  const { error } = await sb.from("comments").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    action: `comment.${action}`,
    entityType: "comment",
    entityId: id,
    before,
    after: patch,
    notes: body.reason,
    actorRole: deriveActorRole(admin),
    request: req,
  });

  return NextResponse.json({ ok: true });
}
