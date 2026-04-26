/**
 * GET /api/admin/moderation/reports
 *
 * Query :
 *   ?status=pending|actioned|dismissed   (default: pending)
 *   ?target_type=kill|comment|community_clip   (optional filter)
 *   ?limit=N                              (max 500, default 200)
 *
 * Returns rows grouped by (target_type, target_id) so the admin UI can
 * present "5 reports about the same kill" as a single triage line.
 *
 * Response :
 *   {
 *     groups: Array<{
 *       target_type, target_id,
 *       count,
 *       reasons: string[],   -- distinct reason_codes
 *       latest_at: ISO,
 *       reports: ReportRow[],
 *       target_meta?: { ... }   -- joined kill thumbnail + matchup, or comment content
 *     }>,
 *     total_groups: number
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_STATUS = new Set(["pending", "actioned", "dismissed"]);
const VALID_TARGET_TYPES = new Set(["kill", "comment", "community_clip"]);

interface ReportRow {
  id: string;
  target_type: string;
  target_id: string;
  reporter_id: string | null;
  reporter_anon_id: string | null;
  reason_code: string;
  reason_text: string | null;
  status: string;
  action_taken: string | null;
  actioned_by: string | null;
  actioned_at: string | null;
  created_at: string;
}

interface KillMeta {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  thumbnail_url: string | null;
  ai_description: string | null;
  kill_visible: boolean | null;
  status: string | null;
  pipeline_status: string | null;
  publication_status: string | null;
}

interface CommentMeta {
  id: string;
  content: string | null;
  is_deleted: boolean | null;
  moderation_status: string | null;
  kill_id: string | null;
}

interface ReportGroup {
  target_type: string;
  target_id: string;
  count: number;
  reasons: string[];
  latest_at: string;
  reports: ReportRow[];
  target_meta: KillMeta | CommentMeta | null;
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const status = sp.get("status") ?? "pending";
  const targetTypeFilter = sp.get("target_type");
  const limit = Math.min(Number(sp.get("limit")) || 200, 500);

  if (!VALID_STATUS.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  if (targetTypeFilter && !VALID_TARGET_TYPES.has(targetTypeFilter)) {
    return NextResponse.json({ error: "Invalid target_type" }, { status: 400 });
  }

  const sb = await createServerSupabase();

  // 1. Fetch the base report rows
  let q = sb
    .from("reports")
    .select(
      "id, target_type, target_id, reporter_id, reporter_anon_id, " +
        "reason_code, reason_text, status, action_taken, actioned_by, " +
        "actioned_at, created_at",
    )
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (targetTypeFilter) {
    q = q.eq("target_type", targetTypeFilter);
  }

  const { data: rawReports, error: reportsErr } = await q;
  if (reportsErr) {
    return NextResponse.json({ error: reportsErr.message }, { status: 500 });
  }

  const reports = (rawReports ?? []) as unknown as ReportRow[];

  // 2. Group by (target_type, target_id)
  const byKey = new Map<string, ReportGroup>();
  for (const r of reports) {
    const key = `${r.target_type}::${r.target_id}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      existing.reports.push(r);
      if (!existing.reasons.includes(r.reason_code)) {
        existing.reasons.push(r.reason_code);
      }
      if (r.created_at > existing.latest_at) {
        existing.latest_at = r.created_at;
      }
    } else {
      byKey.set(key, {
        target_type: r.target_type,
        target_id: r.target_id,
        count: 1,
        reasons: [r.reason_code],
        latest_at: r.created_at,
        reports: [r],
        target_meta: null,
      });
    }
  }

  const groups = Array.from(byKey.values()).sort((a, b) => {
    // Most-reported first, then by recency.
    if (b.count !== a.count) return b.count - a.count;
    return b.latest_at.localeCompare(a.latest_at);
  });

  // 3. Bulk-fetch target metadata (one query per type, not per row).
  const killIds = groups
    .filter((g) => g.target_type === "kill")
    .map((g) => g.target_id);
  const commentIds = groups
    .filter((g) => g.target_type === "comment")
    .map((g) => g.target_id);

  if (killIds.length > 0) {
    const { data: kills } = await sb
      .from("kills")
      .select(
        "id, killer_champion, victim_champion, thumbnail_url, " +
          "ai_description, kill_visible, status, pipeline_status, publication_status",
      )
      .in("id", killIds);
    const byId = new Map<string, KillMeta>();
    for (const k of (kills ?? []) as unknown as KillMeta[]) {
      byId.set(k.id, k);
    }
    for (const g of groups) {
      if (g.target_type === "kill") {
        g.target_meta = byId.get(g.target_id) ?? null;
      }
    }
  }

  if (commentIds.length > 0) {
    const { data: comments } = await sb
      .from("comments")
      .select("id, content, is_deleted, moderation_status, kill_id")
      .in("id", commentIds);
    const byId = new Map<string, CommentMeta>();
    for (const c of (comments ?? []) as unknown as CommentMeta[]) {
      byId.set(c.id, c);
    }
    for (const g of groups) {
      if (g.target_type === "comment") {
        g.target_meta = byId.get(g.target_id) ?? null;
      }
    }
  }

  return NextResponse.json({
    groups,
    total_groups: groups.length,
    total_reports: reports.length,
  });
}
