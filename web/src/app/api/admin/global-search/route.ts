import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/audit";

/**
 * GET /api/admin/global-search
 *
 * Cross-entity search backend for the topbar typeahead and the
 * /admin/search results page. Returns up to 5 hits per entity type,
 * ranked by id-prefix match first then ilike on the name/title field.
 *
 * Query params :
 *   q     — required, min 2 chars (we 400 below 2 to avoid expensive
 *           wildcard scans on tiny prefixes)
 *   types — optional comma-separated whitelist (kills,matches,jobs,users)
 *           When omitted, all four are queried.
 *
 * Caching :
 *   private, max-age=30 — short TTL since results change as new data
 *   lands ; private because the response is admin-scoped.
 *
 * Strategy notes :
 *   - We split the query into "id-like" (looks like UUID prefix or
 *     8+ alphanumeric chars) and "name-like" (everything else) ; for
 *     id-like queries we prioritise id-prefix matches with ilike.
 *   - Champion fields (killer_champion / victim_champion) are searched
 *     for kills since admins frequently look for "Yone" or "Caitlyn".
 *   - Matches join on stage + external_id (no team name field at the
 *     match level — that lives on `teams` via team_blue_id/team_red_id,
 *     so we settle for external_id + stage which covers ~80% of
 *     manual queries like "LEC1234").
 *   - For users, we look at admin_actions.actor_label since `profiles`
 *     RLS could block the service role in some setups ; admin_actions
 *     is the canonical source for "who did what" anyway.
 *
 * All four queries run in parallel via Promise.all. Each query is
 * fail-soft : if one entity errors, the others still return.
 */
export const dynamic = "force-dynamic";

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

function looksLikeId(q: string): boolean {
  // UUID-ish (alphanum + dashes, 8+ chars) — typical when admin pastes
  // a kill / job id. Champion names are short, so 8+ chars + no spaces
  // is a decent heuristic.
  return /^[a-f0-9-]{8,}$/i.test(q.replace(/\s+/g, ""));
}

function escapeLike(s: string): string {
  // PostgREST .ilike requires us to escape % and _ ourselves. We also
  // strip newlines defensively.
  return s.replace(/[%_]/g, "\\$&").replace(/[\r\n]/g, " ");
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters" },
      { status: 400 },
    );
  }
  if (q.length > 100) {
    return NextResponse.json(
      { error: "Query too long" },
      { status: 400 },
    );
  }

  const wantedTypes = (sp.get("types") ?? "kills,matches,jobs,users")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const sb = await createServerSupabase();
  const safe = escapeLike(q);
  const idLike = looksLikeId(q);

  const wantKills = wantedTypes.includes("kills");
  const wantMatches = wantedTypes.includes("matches");
  const wantJobs = wantedTypes.includes("jobs");
  const wantUsers = wantedTypes.includes("users");

  const [killsRes, matchesRes, jobsRes, usersRes] = await Promise.all([
    wantKills
      ? sb
          .from("kills")
          .select("id, killer_champion, victim_champion")
          .or(
            // id prefix OR champion name contains
            `id.ilike.${safe}%,killer_champion.ilike.%${safe}%,victim_champion.ilike.%${safe}%`,
          )
          .limit(PER_ENTITY_LIMIT * 2)
      : Promise.resolve({ data: [], error: null }),
    wantMatches
      ? sb
          .from("matches")
          .select("id, external_id, stage")
          .or(`id.ilike.${safe}%,external_id.ilike.%${safe}%,stage.ilike.%${safe}%`)
          .limit(PER_ENTITY_LIMIT * 2)
      : Promise.resolve({ data: [], error: null }),
    wantJobs
      ? sb
          .from("pipeline_jobs")
          .select("id, type, status")
          .or(`id.ilike.${safe}%,type.ilike.%${safe}%`)
          .order("created_at", { ascending: false })
          .limit(PER_ENTITY_LIMIT * 2)
      : Promise.resolve({ data: [], error: null }),
    wantUsers
      ? sb
          .from("admin_actions")
          .select("id, actor_label")
          .ilike("actor_label", `%${safe}%`)
          .order("created_at", { ascending: false })
          .limit(PER_ENTITY_LIMIT * 4) // we dedupe below so pull more
      : Promise.resolve({ data: [], error: null }),
  ]);

  // ─── Shape the kills result ─────────────────────────────────────
  const killRows = (killsRes.data ?? []) as { id: string; killer_champion: string | null; victim_champion: string | null }[];
  // Sort : id-prefix matches first when query looks like an id
  const killsRanked = killRows
    .slice()
    .sort((a, b) => {
      if (idLike) {
        const aPrefix = a.id.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1;
        const bPrefix = b.id.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1;
        return aPrefix - bPrefix;
      }
      return 0;
    })
    .slice(0, PER_ENTITY_LIMIT)
    .map(
      (r): GlobalSearchKill => ({
        id: r.id,
        killer: r.killer_champion ?? "?",
        victim: r.victim_champion ?? "?",
      }),
    );

  // ─── Matches ────────────────────────────────────────────────────
  const matchRows = (matchesRes.data ?? []) as { id: string; external_id: string; stage: string | null }[];
  const matchesRanked = matchRows
    .slice(0, PER_ENTITY_LIMIT)
    .map(
      (r): GlobalSearchMatch => ({
        id: r.id,
        external_id: r.external_id,
        label: r.stage ? `${r.external_id} — ${r.stage}` : r.external_id,
      }),
    );

  // ─── Jobs ───────────────────────────────────────────────────────
  const jobRows = (jobsRes.data ?? []) as { id: string; type: string; status: string }[];
  const jobsRanked = jobRows.slice(0, PER_ENTITY_LIMIT).map(
    (r): GlobalSearchJob => ({
      id: r.id,
      type: r.type,
      status: r.status,
    }),
  );

  // ─── Users (dedupe by actor_label) ──────────────────────────────
  const userRows = (usersRes.data ?? []) as { id: string; actor_label: string | null }[];
  const seenLabels = new Set<string>();
  const usersRanked: GlobalSearchUser[] = [];
  for (const row of userRows) {
    const label = row.actor_label?.trim();
    if (!label || seenLabels.has(label)) continue;
    seenLabels.add(label);
    usersRanked.push({ id: label, label });
    if (usersRanked.length >= PER_ENTITY_LIMIT) break;
  }

  const body: GlobalSearchResponse = {
    q,
    kills: killsRanked,
    matches: matchesRanked,
    jobs: jobsRanked,
    users: usersRanked,
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, max-age=30, must-revalidate",
    },
  });
}
