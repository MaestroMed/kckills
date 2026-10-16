import { NextRequest, NextResponse } from "next/server";
import { adminRouteDb } from "@/lib/admin/db";

/**
 * GET /api/admin/pipeline/queue — lecture de pipeline_jobs pour l'explorateur
 * /admin/pipeline/jobs.
 *
 * Avant, la page interrogeait pipeline_jobs avec le client Supabase du
 * navigateur : la table n'a pas de policy de lecture, la page affichait
 * 0 job pendant que 4 553 attendaient.
 *
 * Paramètres : status (liste, virgules), kind (liste), age (1h|24h|7d|30d|all),
 * search (UUID du job, ou début d'entity_id), sort (created_at|attempts),
 * dir (asc|desc), offset.
 *
 * GET ?summary=1 — compteurs par type × statut actif (pending, claimed,
 * failed) pour la matrice en tête de page.
 */
const PAGE_SIZE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGES: Record<string, number> = { "1h": 3600e3, "24h": 86400e3, "7d": 7 * 86400e3, "30d": 30 * 86400e3 };

const JOB_TYPES = [
  "match.discover", "live_stats.harvest", "vod.reconcile", "vod.offset_find",
  "channel.discover", "channel.reconcile", "clip.create", "clip.reclip",
  "hls.package", "clip.analyze", "og.generate", "embedding.compute",
  "qc.verify", "qc.reanalyze", "event.map", "publish.check", "publish.retract",
  "feature.pin", "feature.unpin", "kotw.auto_pick", "comment.moderate",
  "cache.flush", "health.heartbeat", "cleanup.expired", "worker.backfill",
] as const;
const SUMMARY_STATUSES = ["pending", "claimed", "failed"] as const;

export async function GET(req: NextRequest) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const { sb } = g;
  const sp = req.nextUrl.searchParams;

  if (sp.get("summary")) {
    const cells = await Promise.all(
      JOB_TYPES.flatMap((type) =>
        SUMMARY_STATUSES.map(async (status) => {
          const { count } = await sb
            .from("pipeline_jobs")
            .select("id", { count: "exact", head: true })
            .eq("type", type)
            .eq("status", status);
          return { type, status, count: count ?? 0 };
        }),
      ),
    );
    const rows = JOB_TYPES.map((type) => {
      const row: Record<string, number | string> = { type };
      for (const s of SUMMARY_STATUSES) row[s] = cells.find((c) => c.type === type && c.status === s)?.count ?? 0;
      return row as { type: string; pending: number; claimed: number; failed: number };
    }).filter((r) => r.pending + r.claimed + r.failed > 0);
    return NextResponse.json({ rows }, { headers: { "Cache-Control": "private, max-age=20" } });
  }

  const statuses = (sp.get("status") ?? "").split(",").filter(Boolean);
  const kinds = (sp.get("kind") ?? "").split(",").filter(Boolean);
  const age = sp.get("age") ?? "24h";
  const search = (sp.get("search") ?? "").trim();
  const sort = sp.get("sort") === "attempts" ? "attempts" : "created_at";
  const ascending = sp.get("dir") === "asc";
  const offset = Math.max(0, Math.min(100_000, parseInt(sp.get("offset") ?? "0", 10) || 0));

  let q = sb
    .from("pipeline_jobs")
    .select(
      "id, type, entity_type, entity_id, status, priority, attempts, max_attempts, last_error, created_at, finished_at",
      { count: "exact" },
    );
  if (statuses.length) q = q.in("status", statuses);
  if (kinds.length) q = q.in("type", kinds);
  if (AGES[age]) q = q.gte("created_at", new Date(Date.now() - AGES[age]).toISOString());
  if (search) {
    if (UUID_RE.test(search)) q = q.or(`id.eq.${search},entity_id.eq.${search}`);
    else q = q.ilike("entity_id", `${search.replace(/[^0-9A-Za-z_-]/g, "")}%`);
  }
  q = q.order(sort, { ascending }).order("id", { ascending }).range(offset, offset + PAGE_SIZE - 1);

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [], count: count ?? null, pageSize: PAGE_SIZE });
}
