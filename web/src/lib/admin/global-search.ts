import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface GlobalSearchKill {
  id: string;
  killer: string;
  victim: string;
}
export interface GlobalSearchMatch {
  id: string;
  external_id: string;
  label: string;
}
export interface GlobalSearchJob {
  id: string;
  type: string;
  status: string;
}
export interface GlobalSearchUser {
  id: string;
  label: string;
}
export interface GlobalSearchResponse {
  q: string;
  kills: GlobalSearchKill[];
  matches: GlobalSearchMatch[];
  jobs: GlobalSearchJob[];
  users: GlobalSearchUser[];
}

const PER_ENTITY_LIMIT = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Terme utilisable dans un filtre `.or()` PostgREST : lettres, chiffres,
 * espace, tiret, apostrophe. Virgules, parenthèses, points et guillemets
 * sont la syntaxe du filtre lui-même (`a.ilike.x,b.eq.y`) : les laisser
 * passer permettait d'ajouter des conditions arbitraires à la requête.
 * `%` et `_` sont retirés aussi (jokers de ILIKE).
 */
export function searchTerm(q: string): string {
  return q.normalize("NFC").replace(/[^\p{L}\p{N} '-]/gu, " ").replace(/\s+/g, " ").trim();
}

export type SearchType = "kills" | "matches" | "jobs" | "users";

/**
 * Recherche transverse de l'admin (barre du haut et /admin/search).
 * Une colonne uuid ne supporte pas ILIKE via PostgREST : un identifiant
 * se cherche donc en entier (égalité), le reste par nom.
 */
export async function runGlobalSearch(
  sb: SupabaseClient,
  rawQ: string,
  wantedTypes: SearchType[],
  perEntity = PER_ENTITY_LIMIT,
): Promise<GlobalSearchResponse> {
  const q = rawQ.trim();
  const isUuid = UUID_RE.test(q);
  const term = searchTerm(q);
  const like = `%${term}%`;
  // Champions stockés au format Data Dragon : « Kaisa », « LeeSin », « MissFortune ».
  const champLike = `%${term.replace(/[' ]/g, "")}%`;
  const empty = Promise.resolve({ data: [] as unknown[], error: null });
  const want = (t: SearchType) => wantedTypes.includes(t) && (isUuid || term.length >= 2);

  const [killsRes, matchesRes, jobsRes, usersRes] = await Promise.all([
    want("kills")
      ? isUuid
        ? sb.from("kills").select("id, killer_champion, victim_champion").eq("id", q).limit(1)
        : sb
            .from("kills")
            .select("id, killer_champion, victim_champion")
            .or(`killer_champion.ilike."${champLike}",victim_champion.ilike."${champLike}"`)
            .order("highlight_score", { ascending: false, nullsFirst: false })
            .limit(perEntity)
      : empty,
    want("matches")
      ? isUuid
        ? sb.from("matches").select("id, external_id, stage").eq("id", q).limit(1)
        : sb
            .from("matches")
            .select("id, external_id, stage")
            .or(`external_id.ilike."${like}",stage.ilike."${like}"`)
            .order("scheduled_at", { ascending: false, nullsFirst: false })
            .limit(perEntity)
      : empty,
    want("jobs")
      ? isUuid
        ? sb.from("pipeline_jobs").select("id, type, status").eq("id", q).limit(1)
        : sb
            .from("pipeline_jobs")
            .select("id, type, status")
            .ilike("type", like)
            .order("created_at", { ascending: false })
            .limit(perEntity)
      : empty,
    want("users") && !isUuid
      ? sb
          .from("admin_actions")
          .select("id, actor_label")
          .ilike("actor_label", like)
          .order("created_at", { ascending: false })
          .limit(perEntity * 4) // dédoublonné plus bas
      : empty,
  ]);

  const kills = ((killsRes.data ?? []) as { id: string; killer_champion: string | null; victim_champion: string | null }[])
    .map((r): GlobalSearchKill => ({ id: r.id, killer: r.killer_champion ?? "?", victim: r.victim_champion ?? "?" }));
  const matches = ((matchesRes.data ?? []) as { id: string; external_id: string; stage: string | null }[])
    .map((r): GlobalSearchMatch => ({ id: r.id, external_id: r.external_id, label: r.stage ? `${r.external_id} — ${r.stage}` : r.external_id }));
  const jobs = ((jobsRes.data ?? []) as { id: string; type: string; status: string }[])
    .map((r): GlobalSearchJob => ({ id: r.id, type: r.type, status: r.status }));
  const seen = new Set<string>();
  const users: GlobalSearchUser[] = [];
  for (const row of (usersRes.data ?? []) as { id: string; actor_label: string | null }[]) {
    const label = row.actor_label?.trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    users.push({ id: label, label });
    if (users.length >= perEntity) break;
  }
  return { q, kills, matches, jobs, users };
}
