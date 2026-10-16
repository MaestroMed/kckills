import "server-only";
import type { AdminDb } from "@/lib/admin/db";
import { fetchAll } from "@/lib/admin/paginate";

/**
 * Vue « games » de l'admin : chaque game avec sa VOD, son offset et les
 * problèmes qui faussent ses clips.
 *
 *   unknown : VOD YouTube connue mais offset NULL ou 0 (le clipper coupait
 *             dans le pré-show — quarantaine du 29/09)
 *   shared  : même VOD au même offset que d'autres games du match (une
 *             seule peut être juste — audit du 30/09)
 *   novod   : aucune VOD
 *   winner  : game d'un match terminé sans vainqueur renseigné
 */
export type GameIssue = "unknown" | "shared" | "novod" | "winner";

export interface AdminGameRow {
  id: string;
  external_id: string;
  game_number: number;
  vod_youtube_id: string | null;
  vod_offset_seconds: number | null;
  data_source: string | null;
  winner_team_id: string | null;
  match_id: string | null;
  date: string | null;
  stage: string | null;
  tournament: string | null;
  opponent: string | null;
  kills: number;
  published: number;
  reclip: number;
  issues: GameIssue[];
}

interface GameDb {
  id: string;
  external_id: string;
  match_id: string | null;
  game_number: number;
  winner_team_id: string | null;
  vod_youtube_id: string | null;
  vod_offset_seconds: number | null;
  data_source: string | null;
  matches: {
    stage: string | null;
    scheduled_at: string | null;
    state: string | null;
    winner_team_id: string | null;
    team_blue_id: string | null;
    team_red_id: string | null;
    tournaments: { name: string | null; year: number | null } | null;
  } | null;
}

export async function loadAdminGames(sb: AdminDb): Promise<AdminGameRow[]> {
  const [games, teams, kills] = await Promise.all([
    fetchAll<GameDb>((from, to) =>
      sb
        .from("games")
        .select(
          "id, external_id, match_id, game_number, winner_team_id, vod_youtube_id, vod_offset_seconds, data_source, " +
            "matches (stage, scheduled_at, state, winner_team_id, team_blue_id, team_red_id, tournaments (name, year))",
        )
        .order("id")
        .range(from, to),
    ),
    sb.from("teams").select("id, code, is_tracked"),
    fetchAll<{ game_id: string; kill_visible: boolean | null; needs_reclip: boolean | null; publication_status: string | null; status: string | null }>(
      (from, to) =>
        sb
          .from("kills")
          .select("game_id, kill_visible, needs_reclip, publication_status, status")
          .not("clip_url_vertical", "is", null)
          .order("id")
          .range(from, to),
    ),
  ]);

  const teamCode = new Map((teams.data ?? []).map((t) => [t.id as string, t.code as string]));
  const kc = (teams.data ?? []).find((t) => t.is_tracked)?.id as string | undefined;

  const perGame = new Map<string, { kills: number; published: number; reclip: number }>();
  for (const k of kills) {
    const c = perGame.get(k.game_id) ?? { kills: 0, published: 0, reclip: 0 };
    c.kills++;
    const pub = k.publication_status === "published" || (k.publication_status == null && k.status === "published");
    if (pub && k.kill_visible) c.published++;
    if (k.needs_reclip) c.reclip++;
    perGame.set(k.game_id, c);
  }

  const sharedKey = (g: GameDb) =>
    g.vod_youtube_id && g.vod_offset_seconds ? `${g.match_id}|${g.vod_youtube_id}|${g.vod_offset_seconds}` : null;
  const sharedCount = new Map<string, number>();
  for (const g of games) {
    const k = sharedKey(g);
    if (k) sharedCount.set(k, (sharedCount.get(k) ?? 0) + 1);
  }

  return games.map((g) => {
    const m = g.matches;
    const issues: GameIssue[] = [];
    if (!g.vod_youtube_id) issues.push("novod");
    else if (!g.vod_offset_seconds) issues.push("unknown");
    const sk = sharedKey(g);
    if (sk && (sharedCount.get(sk) ?? 0) > 1) issues.push("shared");
    if (m?.state === "completed" && !g.winner_team_id) issues.push("winner");
    const oppId = m ? (m.team_blue_id === kc ? m.team_red_id : m.team_blue_id) : null;
    const c = perGame.get(g.id) ?? { kills: 0, published: 0, reclip: 0 };
    return {
      id: g.id,
      external_id: g.external_id,
      game_number: g.game_number,
      vod_youtube_id: g.vod_youtube_id,
      vod_offset_seconds: g.vod_offset_seconds,
      data_source: g.data_source,
      winner_team_id: g.winner_team_id,
      match_id: g.match_id,
      date: m?.scheduled_at ?? null,
      stage: m?.stage ?? null,
      tournament: m?.tournaments ? [m.tournaments.name, m.tournaments.year].filter(Boolean).join(" ") || null : null,
      opponent: oppId ? teamCode.get(oppId) ?? null : null,
      ...c,
      issues,
    };
  });
}
