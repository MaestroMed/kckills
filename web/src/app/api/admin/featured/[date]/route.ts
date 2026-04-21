import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/** PUT /api/admin/featured/[date] — set featured kill for a date */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
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

  // Audit
  await sb.from("admin_actions").insert({
    actor_label: "admin",
    action: "featured.set",
    entity_type: "featured",
    entity_id: date,
    after: { kill_id: killId, notes },
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

/** DELETE /api/admin/featured/[date] — remove featured for a date */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  const sb = await createServerSupabase();
  const { error } = await sb.from("featured_clips").delete().eq("feature_date", date);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sb.from("admin_actions").insert({
    actor_label: "admin",
    action: "featured.delete",
    entity_type: "featured",
    entity_id: date,
  });

  return NextResponse.json({ ok: true });
}
