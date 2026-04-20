import { createServerSupabase } from "@/lib/supabase/server";
import { getPublishedKills } from "@/lib/supabase/kills";
import { FeaturedPicker } from "./featured-picker";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Featured — Admin",
  robots: { index: false, follow: false },
};

export default async function FeaturedPage() {
  const sb = await createServerSupabase();

  // Get featured for last 14 + next 7 days
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - 14);
  const to = new Date(today);
  to.setDate(today.getDate() + 7);

  const [featured, allKills] = await Promise.all([
    sb
      .from("featured_clips")
      .select("feature_date,kill_id,notes,set_at,set_by_actor")
      .gte("feature_date", from.toISOString().slice(0, 10))
      .lte("feature_date", to.toISOString().slice(0, 10))
      .order("feature_date", { ascending: false }),
    getPublishedKills(500),
  ]);

  // Build kill lookup
  const killMap = new Map(
    allKills
      .filter((k) => k.tracked_team_involvement === "team_killer" && k.kill_visible !== false)
      .map((k) => [
        k.id,
        {
          id: k.id,
          killerChampion: k.killer_champion ?? "?",
          victimChampion: k.victim_champion ?? "?",
          thumbnail: k.thumbnail_url,
          highlightScore: k.highlight_score,
          aiDescription: k.ai_description,
          fightType: k.fight_type,
          gameDate: k.games?.matches?.scheduled_at ?? null,
        },
      ]),
  );

  const featuredWithKill = (featured.data ?? []).map((f) => ({
    date: f.feature_date,
    notes: f.notes,
    setAt: f.set_at,
    setBy: f.set_by_actor,
    kill: killMap.get(f.kill_id) ?? null,
  }));

  // Top kills (for picker)
  const topKills = Array.from(killMap.values())
    .filter((k) => (k.highlightScore ?? 0) >= 7)
    .sort((a, b) => (b.highlightScore ?? 0) - (a.highlightScore ?? 0))
    .slice(0, 50);

  return <FeaturedPicker featured={featuredWithKill} topKills={topKills} />;
}
