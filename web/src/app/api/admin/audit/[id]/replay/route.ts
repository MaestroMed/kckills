import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * POST /api/admin/audit/[id]/replay
 *
 * Re-applies the `after` JSON of an admin_actions row to its entity.
 * Useful when you want to undo a recent change or repeat a fix.
 *
 * Currently supports replaying:
 *   - kill.edit / kill.bulk — re-apply patch to kills table
 *   - player.edit — re-apply patch to players table
 *   - featured.set — re-apply featured pick
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

    // Log the replay itself as an audit action
    await sb.from("admin_actions").insert({
      actor_label: "admin (replay)",
      action: `${action.action}.replayed`,
      entity_type: action.entity_type,
      entity_id: action.entity_id,
      after,
      notes: `Replayed audit action ${id}`,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
