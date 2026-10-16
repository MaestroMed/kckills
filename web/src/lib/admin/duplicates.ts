import "server-only";
import type { AdminDb } from "@/lib/admin/db";
import { fetchAll } from "@/lib/admin/paginate";
import { readConfig } from "@/lib/admin/config-store";

/**
 * Doublons probables parmi les clips en ligne : même jour de match, même
 * numéro de game, même tueur et même victime (champions), à moins de 15 s
 * d'écart. Deux cas réels :
 *   · la même game importée deux fois (gol.gg + feed officiel, 1 611 kills
 *     neutralisés le 23/09 — il en reste) ;
 *   · le même kill détecté deux fois dans une game.
 * Les noms de champions diffèrent d'une source à l'autre (« MonkeyKing » /
 * « Wukong », « KhaZix » / « Khazix ») : on compare une forme normalisée.
 */
export interface DupKill {
  id: string;
  game_id: string;
  game_number: number | null;
  data_source: string | null;
  killer_champion: string | null;
  victim_champion: string | null;
  game_time_seconds: number | null;
  thumbnail_url: string | null;
  clip_url_vertical: string | null;
  highlight_score: number | null;
  rating_count: number | null;
  comment_count: number | null;
  ai_description: string | null;
}
export interface DupPair {
  key: string;
  a: DupKill;
  b: DupKill;
  sameGame: boolean;
  dt: number;
  match: string;
}

const ALIASES: Record<string, string> = { monkeyking: "wukong", renataglasc: "renata", nunuwillump: "nunu" };
const norm = (c: string | null) => {
  const k = (c ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return ALIASES[k] ?? k;
};
export const pairKey = (a: string, b: string) => [a, b].sort().join("|");

interface Row extends Omit<DupKill, "game_number" | "data_source"> {
  games: { game_number: number | null; data_source: string | null; match_id: string | null; matches: { stage: string | null; scheduled_at: string | null } | null } | null;
}

export async function findDuplicatePairs(sb: AdminDb): Promise<DupPair[]> {
  const [rows, ignored] = await Promise.all([
    fetchAll<Row>((from, to) =>
      sb
        .from("kills")
        .select(
          "id, game_id, killer_champion, victim_champion, game_time_seconds, thumbnail_url, clip_url_vertical, highlight_score, " +
            "rating_count, comment_count, ai_description, games (game_number, data_source, match_id, matches (stage, scheduled_at))",
        )
        .or("publication_status.eq.published,and(publication_status.is.null,status.eq.published)")
        .eq("kill_visible", true)
        .not("game_time_seconds", "is", null)
        .order("id")
        .range(from, to),
    ),
    readConfig<{ keys: string[] }>("dedup-ignored"),
  ]);
  const skip = new Set(ignored?.keys ?? []);

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const g = r.games;
    // Jour du match plutôt que match_id : l'import gol.gg crée parfois son
    // propre match pour la même série (les 3 doublons trouvés le 16/10).
    const day = g?.matches?.scheduled_at?.slice(0, 10);
    if (!g || !day) continue;
    const key = `${day}|${g.game_number}|${norm(r.killer_champion)}|${norm(r.victim_champion)}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const toKill = (r: Row): DupKill => ({
    ...r,
    game_number: r.games?.game_number ?? null,
    data_source: r.games?.data_source ?? null,
  });
  const pairs: DupPair[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((x, y) => (x.game_time_seconds ?? 0) - (y.game_time_seconds ?? 0));
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      const dt = Math.abs((b.game_time_seconds ?? 0) - (a.game_time_seconds ?? 0));
      if (dt > 15) continue;
      const key = pairKey(a.id, b.id);
      if (skip.has(key)) continue;
      const m = a.games?.matches;
      pairs.push({
        key,
        a: toKill(a),
        b: toKill(b),
        sameGame: a.game_id === b.game_id,
        dt,
        match: [m?.stage, m?.scheduled_at ? new Date(m.scheduled_at).toLocaleDateString("fr-FR") : null].filter(Boolean).join(" · "),
      });
    }
  }
  return pairs.sort((x, y) => x.dt - y.dt);
}
