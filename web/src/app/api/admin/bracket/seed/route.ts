import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { deriveActorRole, logAdminAction, requireAdmin } from "@/lib/admin/audit";

/**
 * POST /api/admin/bracket/seed
 *
 * Body : { monthYear: "YYYY-MM" }   e.g. "2026-05" for "Mai 2026"
 *
 * Calls fn_seed_monthly_bracket(text) which :
 *   1. Picks the top N kills from that month (by avg_rating, highlight_score)
 *   2. Creates the bracket_tournaments row
 *   3. Seeds bracket_matches rows for Round 1 (with empty later rounds)
 *   4. Returns (tournament_id, bracket_size, seeded_count, errors[])
 *
 * Idempotent : re-calling for the same month raises an exception inside
 * the RPC. The client surfaces that as a 409 error.
 */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { monthYear?: string };
  const monthYear = (body.monthYear ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthYear)) {
    return NextResponse.json(
      { error: 'monthYear must be "YYYY-MM" (e.g. "2026-05")' },
      { status: 400 },
    );
  }

  const sb = await createServerSupabase();
  const { data, error } = await sb.rpc("fn_seed_monthly_bracket", {
    p_month_year: monthYear,
  });

  if (error) {
    const isConflict = /already exists/i.test(error.message);
    return NextResponse.json(
      { error: error.message },
      { status: isConflict ? 409 : 500 },
    );
  }

  const result = Array.isArray(data) && data.length > 0 ? data[0] : null;

  await logAdminAction({
    action: "bracket.seed",
    entityType: "bracket_tournament",
    entityId: result?.tournament_id ?? monthYear,
    before: null,
    after: { monthYear, ...(result ?? {}) },
    actorRole: deriveActorRole(admin),
    request: req,
  });

  return NextResponse.json({ ok: true, result });
}
