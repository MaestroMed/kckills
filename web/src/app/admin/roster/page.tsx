import { adminPageDb } from "@/lib/admin/db";
import { fetchAll } from "@/lib/admin/paginate";
import { loadRealData, getCurrentRoster } from "@/lib/real-data";
import { RosterEditor } from "./roster-editor";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Roster — Admin",
  robots: { index: false, follow: false },
};

export default async function RosterPage() {
  const sb = await adminPageDb();

  // Get all players + their teams
  // Lectures complètes (pages de 1 000) : un SELECT simple s'arrête à
  // 1 000 lignes, les compteurs de kills étaient faux.
  const [playerRows, teams, killRows] = await Promise.all([
    fetchAll<{ id: string; ign: string; real_name: string | null; role: string | null; nationality: string | null; image_url: string | null; team_id: string | null; external_id: string | null; created_at: string }>((from, to) =>
      sb.from("players").select("id,ign,real_name,role,nationality,image_url,team_id,external_id,created_at").order("ign").order("id").range(from, to)),
    sb.from("teams").select("id,name,code,is_tracked"),
    fetchAll<{ killer_player_id: string | null }>((from, to) =>
      sb.from("kills").select("killer_player_id").not("killer_player_id", "is", null).order("id").range(from, to)),
  ]);
  const players = { data: playerRows };
  const killsAgg = { data: killRows };

  // Titulaires = les joueurs KC alignés en 2026 (même source que le site).
  // is_tracked seul désigne l'équipe : tous les anciens de KC y sont encore.
  const starters = new Set(getCurrentRoster(loadRealData()).map((p) => p.name.toLowerCase()));

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
    // Certaines photos lolesports sont stockées en http:// : next/image ne
    // les autorise qu'en https (et le CSP aussi).
    image_url: p.image_url?.replace(/^http:\/\//, "https://") ?? null,
    teamCode: p.team_id ? teamMap.get(p.team_id)?.code ?? null : null,
    teamName: p.team_id ? teamMap.get(p.team_id)?.name ?? null : null,
    isKc: p.team_id ? teamMap.get(p.team_id)?.is_tracked ?? false : false,
    isStarter: starters.has(p.ign.toLowerCase()),
    killCount: killCount.get(p.id) ?? 0,
  }));

  return <RosterEditor players={enriched} teams={teams.data ?? []} />;
}
