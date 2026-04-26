/**
 * /api/comments/[id]/vote — Reddit-style upvote / downvote on a comment.
 *
 * POST { vote: -1 | 0 | 1 }
 *
 * - vote = +1   → upvote (insert if absent, update if previously -1)
 * - vote = -1   → downvote (insert if absent, update if previously +1)
 * - vote = 0    → remove the user's vote (DELETE the row)
 *
 * Returns { upvotes: number, userVote: -1 | 0 | 1, downvotes: number }
 *   - `upvotes`   : the running SUM(vote_value) (ie. score, can be negative)
 *   - `downvotes` : the count of -1 votes (used by the Wilson sort on the
 *                   client to compute lower-bound confidence interval)
 *   - `userVote`  : the user's resulting vote after the change
 *
 * Auth required — anonymous users get a 401 and the UI shows a login prompt.
 *
 * The trigger `trg_comment_votes_recompute` (migration 038) automatically
 * keeps `comments.upvotes` in sync — we don't need to PATCH it manually
 * here. We DO read it back after the write to return the canonical value
 * to the client (avoids client-side drift on rapid re-votes).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface VoteRequest {
  vote?: unknown;
}

function parseVote(raw: unknown): -1 | 0 | 1 | null {
  if (raw === -1 || raw === 0 || raw === 1) return raw;
  if (typeof raw === "string") {
    if (raw === "-1") return -1;
    if (raw === "0") return 0;
    if (raw === "1") return 1;
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Validate the comment id shape — UUID v4 expected. PostgREST will reject
  // an invalid UUID with a 400 anyway, but we short-circuit to keep the
  // error message stable for the UI.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Identifiant invalide" }, { status: 400 });
  }

  let body: VoteRequest;
  try {
    body = (await request.json()) as VoteRequest;
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const vote = parseVote(body.vote);
  if (vote === null) {
    return NextResponse.json(
      { error: "Vote invalide (attendu : -1, 0 ou 1)" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Connecte-toi pour voter" },
      { status: 401 },
    );
  }

  // Apply the change. Three cases :
  //   vote = 0  → DELETE the row (user removes their vote)
  //   vote = ±1 → UPSERT — insert if absent, update vote_value if exists
  if (vote === 0) {
    const { error: deleteErr } = await supabase
      .from("comment_votes")
      .delete()
      .eq("comment_id", id)
      .eq("user_id", user.id);
    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }
  } else {
    // upsert on (comment_id, user_id) — the unique constraint we defined
    // in migration 038 is the conflict target.
    const { error: upsertErr } = await supabase
      .from("comment_votes")
      .upsert(
        {
          comment_id: id,
          user_id: user.id,
          vote_value: vote,
        },
        { onConflict: "comment_id,user_id" },
      );
    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }
  }

  // Read back the canonical state. Two queries :
  //   1. comments.upvotes (the running SUM(vote_value)) — kept fresh by
  //      the recompute trigger fired by the write above.
  //   2. count of -1 votes for the Wilson sort (separate from upvotes
  //      since the column is a sum, not a count).
  const [killRes, downvotesRes] = await Promise.all([
    supabase.from("comments").select("upvotes").eq("id", id).maybeSingle(),
    supabase
      .from("comment_votes")
      .select("id", { count: "exact", head: true })
      .eq("comment_id", id)
      .eq("vote_value", -1),
  ]);

  const upvotes = (killRes.data?.upvotes as number | null) ?? 0;
  const downvotes = downvotesRes.count ?? 0;

  return NextResponse.json({
    upvotes,
    downvotes,
    userVote: vote,
  });
}
