import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { deriveActorRole, logAdminAction, requireAdmin } from "@/lib/admin/audit";

/**
 * POST /api/admin/bracket/close-round
 *
 * Body : { tournamentId: UUID, round: 1..6 }
 *
 * Calls fn_close_round(uuid, int) which :
 *   1. For each undecided match in (tournament_id, round) :
 *        winner_kill_id = whichever side has more votes (tie → null)
 *   2. Seeds the next round (kill_a_id, kill_b_id) from the winners.
 *   3. When closing round 6 (Final), sets tournament.champion_kill_id +
 *      flips status to 'closed'.
 *
 * Idempotent : closing the same round twice is a no-op (already-decided
 * matches are skipped inside the RPC).
 */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    tournamentId?: string;
    round?: number;
  };

  const tournamentId = body.tournamentId;
  const round = body.round;

  if (!tournamentId || typeof tournamentId !== "string") {
    return NextResponse.json(
      { error: "tournamentId (UUID) required" },
      { status: 400 },
    );
  }
  if (!round || round < 1 || round > 6) {
    return NextResponse.json(
      { error: "round must be 1..6" },
      { status: 400 },
    );
  }

  const sb = await createServerSupabase();
  const { data, error } = await sb.rpc("fn_close_round", {
    p_tournament_id: tournamentId,
    p_round: round,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAdminAction({
    action: "bracket.close_round",
    entityType: "bracket_tournament",
    entityId: tournamentId,
    before: { round },
    after: data ?? null,
    actorRole: deriveActorRole(admin),
    request: req,
  });

  return NextResponse.json({ ok: true, result: data });
}
