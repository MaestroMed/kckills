import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * GET /api/palette/clips — Slim clip index for the Cmd-K command palette.
 *
 * Returns up to 200 published kills, ordered by highlight_score, stripped
 * down to ONLY the fields the palette renders: id + killer + victim +
 * description (which becomes the searchable text). No clip URLs, no
 * tags, no scores — those live on /kill/[id].
 *
 * Cached aggressively (s-maxage=300) because the palette doesn't need
 * second-by-second freshness — every page load already calls this at
 * most once per session.
 */
export const revalidate = 300;

export async function GET() {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("kills")
      .select(
        "id, killer_champion, victim_champion, ai_description, multi_kill, is_first_blood, tracked_team_involvement, highlight_score",
      )
      .eq("status", "published")
      .eq("kill_visible", true)
      .not("clip_url_vertical", "is", null)
      .order("highlight_score", { ascending: false, nullsFirst: false })
      .limit(200);

    if (error) {
      console.warn("[api/palette/clips] error:", error.message);
      return NextResponse.json([], { status: 200 });
    }

    // Normalise to a tight wire format. Each row ~150-200 bytes — the
    // full payload is ~30KB, comfortably small for a Cmd-K open hit.
    const out = (data ?? []).map((k: Record<string, unknown>) => ({
      id: String(k.id),
      killer: (k.killer_champion as string | null) ?? "?",
      victim: (k.victim_champion as string | null) ?? "?",
      desc: (k.ai_description as string | null) ?? "",
      multi: (k.multi_kill as string | null) ?? null,
      fb: Boolean(k.is_first_blood),
      side: (k.tracked_team_involvement as string | null) ?? null,
      score: (k.highlight_score as number | null) ?? null,
    }));
    return NextResponse.json(out, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
    });
  } catch (err) {
    console.warn("[api/palette/clips] threw:", err);
    return NextResponse.json([], { status: 200 });
  }
}
