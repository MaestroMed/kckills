/**
 * POST /api/admin/editorial/discord
 *
 * Pushes a single kill to the configured Discord webhook as a
 * gold-accent embed — same look as the kill_of_the_week worker module
 * but triggered manually by the editor on demand.
 *
 * Body : { kill_id, message? }
 *   message : optional short string prepended to the embed (e.g. an
 *             editorial caption). Defaults to a generic "Pick éditorial".
 *
 * Idempotency : we DON'T deduplicate — pushing the same clip twice is
 * a valid editorial action (e.g. pre-game teaser then post-game recap).
 * If we ever need true idempotency the editorial_actions audit row
 * gives us the seam.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/audit";

interface PushBody {
  kill_id?: string;
  message?: string;
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  let body: PushBody;
  try {
    body = (await request.json()) as PushBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { kill_id } = body;
  const message =
    typeof body.message === "string" && body.message.trim()
      ? body.message.slice(0, 280)
      : "🔥 **Pick éditorial** — un clip qu'on voulait absolument vous montrer";

  if (!kill_id) {
    return NextResponse.json({ error: "kill_id required" }, { status: 400 });
  }

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json(
      { error: "DISCORD_WEBHOOK_URL not configured" },
      { status: 500 },
    );
  }

  const sb = await createServerSupabase();

  const { data: killRaw, error: killErr } = await sb
    .from("kills")
    .select("id,killer_champion,victim_champion,thumbnail_url,highlight_score,ai_description,multi_kill,is_first_blood")
    .eq("id", kill_id)
    .maybeSingle();
  const kill = killRaw as unknown as {
    id: string;
    killer_champion: string | null;
    victim_champion: string | null;
    thumbnail_url: string | null;
    highlight_score: number | null;
    ai_description: string | null;
    multi_kill: string | null;
    is_first_blood: boolean | null;
  } | null;
  if (killErr) return NextResponse.json({ error: killErr.message }, { status: 500 });
  if (!kill) return NextResponse.json({ error: "Kill not found" }, { status: 404 });

  const score = kill.highlight_score;
  const scoreStr = typeof score === "number" ? score.toFixed(1) : "?";
  const desc = (kill.ai_description ?? "Clip Karmine Corp").trim().slice(0, 300);
  const tags = [
    kill.multi_kill ? `**${kill.multi_kill}**` : null,
    kill.is_first_blood ? "**First Blood**" : null,
  ].filter(Boolean).join(" · ");

  const embed = {
    title: `★ ${kill.killer_champion} → ${kill.victim_champion}`,
    description: tags ? `${tags}\n\n${desc}` : desc,
    url: `https://kckills.com/scroll?kill=${kill.id}`,
    color: 0xC8AA6E,
    fields: [
      { name: "Score", value: `${scoreStr}/10`, inline: true },
    ],
    footer: { text: "KCKILLS · pick éditorial" },
    timestamp: new Date().toISOString(),
    ...(kill.thumbnail_url ? { thumbnail: { url: kill.thumbnail_url } } : {}),
  };

  try {
    const r = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message, embeds: [embed] }),
    });
    if (!r.ok) {
      const text = await r.text();
      return NextResponse.json(
        { error: `Discord webhook ${r.status}`, detail: text.slice(0, 200) },
        { status: 502 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Discord push failed" },
      { status: 502 },
    );
  }

  await sb.from("editorial_actions").insert({
    action: "discord.push",
    kill_id,
    performed_by: "admin",
    payload: { message, score },
  });

  return NextResponse.json({ ok: true });
}
