import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { deriveActorRole, logAdminAction, requireAdmin } from "@/lib/admin/audit";

/** PUT /api/admin/featured/[date] — set featured kill for a date.
 *  SECURITY (PR-SECURITY-A) : was missing requireAdmin. Now gated.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }
  const { date } = await params;
  const body = await request.json();
  const killId = body.kill_id;
  const notes = typeof body.notes === "string" ? body.notes : null;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date format (YYYY-MM-DD)" }, { status: 400 });
  }
  if (!killId) {
    return NextResponse.json({ error: "kill_id required" }, { status: 400 });
  }

  const sb = await createServerSupabase();

  // Snapshot the prior featured (if any) so the audit shows what was replaced.
  const { data: before } = await sb
    .from("featured_clips")
    .select("kill_id,notes,set_by_actor,set_at")
    .eq("feature_date", date)
    .maybeSingle();

  const { error } = await sb
    .from("featured_clips")
    .upsert(
      {
        feature_date: date,
        kill_id: killId,
        notes,
        set_by_actor: "admin",
        set_at: new Date().toISOString(),
      },
      { onConflict: "feature_date" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAdminAction({
    action: "featured.set",
    entityType: "featured",
    entityId: date,
    before,
    after: { kill_id: killId, notes },
    actorRole: deriveActorRole(admin),
    request,
  });

  // Notify Discord (only for today's featured)
  const today = new Date().toISOString().slice(0, 10);
  if (date === today) {
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (webhook) {
      const { data: kill } = await sb
        .from("kills")
        .select("killer_champion,victim_champion,ai_description,thumbnail_url,highlight_score")
        .eq("id", killId)
        .maybeSingle();
      if (kill) {
        try {
          await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              embeds: [{
                title: `★ Clip vedette du jour : ${kill.killer_champion} → ${kill.victim_champion}`,
                description: kill.ai_description ?? "",
                url: `https://kckills.com/scroll?kill=${killId}`,
                color: 0xFFD700,
                thumbnail: kill.thumbnail_url ? { url: kill.thumbnail_url } : undefined,
                footer: { text: `Score ${kill.highlight_score?.toFixed(1) ?? "?"}/10 · KCKILLS` },
                timestamp: new Date().toISOString(),
              }],
            }),
          });
        } catch { /* discord failure is non-blocking */ }
      }
    }
  }

  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/featured/[date] — remove featured for a date.
 *  SECURITY (PR-SECURITY-A) : was missing requireAdmin. Now gated.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }
  const { date } = await params;
  const sb = await createServerSupabase();

  const { data: before } = await sb
    .from("featured_clips")
    .select("kill_id,notes,set_by_actor,set_at")
    .eq("feature_date", date)
    .maybeSingle();

  const { error } = await sb.from("featured_clips").delete().eq("feature_date", date);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction({
    action: "featured.delete",
    entityType: "featured",
    entityId: date,
    before,
    actorRole: deriveActorRole(admin),
    request,
  });

  return NextResponse.json({ ok: true });
}
