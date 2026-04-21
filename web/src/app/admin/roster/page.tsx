import { createServerSupabase } from "@/lib/supabase/server";
import { RosterEditor } from "./roster-editor";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Roster — Admin",
  robots: { index: false, follow: false },
};

export default async function RosterPage() {
  const sb = await createServerSupabase();

  // Get all players + their teams
  const [players, teams, killsAgg] = await Promise.all([
    sb.from("players").select("id,ign,real_name,role,nationality,image_url,team_id,external_id,created_at").order("ign"),
    sb.from("teams").select("id,name,code,is_tracked"),
    sb.from("kills").select("killer_player_id"),
  ]);

  // Build kill counts per player
  const killCount = new Map<string, number>();
  for (const k of (killsAgg.data ?? [])) {
    if (k.killer_player_id) {
      killCount.set(k.killer_player_id, (killCount.get(k.killer_player_id) ?? 0) + 1);
    }
  }

  const teamMap = new Map((teams.data ?? []).map((t) => [t.id, t]));

  const enriched = (players.data ?? []).map((p) => ({
    ...p,
    teamCode: p.team_id ? teamMap.get(p.team_id)?.code ?? null : null,
    teamName: p.team_id ? teamMap.get(p.team_id)?.name ?? null : null,
    isKc: p.team_id ? teamMap.get(p.team_id)?.is_tracked ?? false : false,
    killCount: killCount.get(p.id) ?? 0,
  }));

  return <RosterEditor players={enriched} teams={teams.data ?? []} />;
}
