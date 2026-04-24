import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { deriveActorRole, logAdminAction, requireAdmin } from "@/lib/admin/audit";

/**
 * POST /api/admin/audit/[id]/replay
 *
 * Re-applies the `after` JSON of an admin_actions row to its entity.
 * Useful when you want to undo a recent change or repeat a fix.
 *
 * SECURITY (PR-SECURITY-A) : was missing requireAdmin check. Now gated.
 *
 * Currently supports replaying:
 *   - kill.edit / kill.bulk — re-apply patch to kills table
 *   - player.edit — re-apply patch to players table
 *   - featured.set — re-apply featured pick
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }
  const { id } = await params;
  const sb = await createServerSupabase();

  const { data: action, error: fetchErr } = await sb
    .from("admin_actions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr || !action) {
    return NextResponse.json({ error: "Action not found" }, { status: 404 });
  }

  const after = action.after as Record<string, unknown> | null;
  if (!after) {
    return NextResponse.json({ error: "No 'after' state to replay" }, { status: 400 });
  }

  let result: { table: string; affected: number };
  try {
    if (action.action.startsWith("kill.") && action.entity_id) {
      const { error } = await sb.from("kills").update(after).eq("id", action.entity_id);
      if (error) throw error;
      result = { table: "kills", affected: 1 };
    } else if (action.action.startsWith("player.") && action.entity_id) {
      const { error } = await sb.from("players").update(after).eq("id", action.entity_id);
      if (error) throw error;
      result = { table: "players", affected: 1 };
    } else if (action.action === "featured.set" && action.entity_id) {
      const { error } = await sb.from("featured_clips").upsert({
        feature_date: action.entity_id,
        ...after,
      }, { onConflict: "feature_date" });
      if (error) throw error;
      result = { table: "featured_clips", affected: 1 };
    } else {
      return NextResponse.json({ error: `Cannot replay action kind: ${action.action}` }, { status: 400 });
    }

    // Log the replay itself as an audit action — uses the strengthened
    // helper so we capture actor role + IP + UA on the replay too.
    await logAdminAction({
      action: `${action.action}.replayed`,
      entityType: action.entity_type,
      entityId: action.entity_id,
      after,
      notes: `Replayed audit action ${id}`,
      actorLabel: "admin (replay)",
      actorRole: deriveActorRole(admin),
      request,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
