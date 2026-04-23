import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/audit";

const VALID_ROLES = ["top", "jungle", "mid", "bottom", "support"];

/** PATCH /api/admin/players/[id] — update a player.
 *  SECURITY (PR-SECURITY-A) : was missing requireAdmin. Now gated.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json();

  const patch: Record<string, unknown> = {};
  if (typeof body.real_name === "string" || body.real_name === null) patch.real_name = body.real_name;
  if (typeof body.nationality === "string" || body.nationality === null) patch.nationality = body.nationality;
  if (typeof body.image_url === "string" || body.image_url === null) patch.image_url = body.image_url;
  if (typeof body.team_id === "string" || body.team_id === null) patch.team_id = body.team_id;
  if (typeof body.role === "string" && VALID_ROLES.includes(body.role)) patch.role = body.role;
  if (body.role === null) patch.role = null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const sb = await createServerSupabase();
  const { data: before } = await sb.from("players").select("*").eq("id", id).maybeSingle();
  const { error } = await sb.from("players").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sb.from("admin_actions").insert({
    actor_label: "admin",
    action: "player.edit",
    entity_type: "player",
    entity_id: id,
    before: before ? Object.fromEntries(Object.keys(patch).map((k) => [k, (before as Record<string, unknown>)[k]])) : null,
    after: patch,
  });

  return NextResponse.json({ ok: true });
}
