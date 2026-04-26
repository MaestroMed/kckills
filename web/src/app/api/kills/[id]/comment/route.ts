import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

const PROFILE_SELECT = "id, discord_username, discord_avatar_url, badges";
// Wave 7 (Agent AF) — `upvotes` is now the running SUM(vote_value) from
// the comment_votes recompute trigger (migration 038). It can be negative
// when downvotes outweigh upvotes. The client uses this for both display
// and the Wilson "Top" sort.
const COMMENT_SELECT = `id, content, created_at, parent_id, upvotes, moderation_status, user_id, profile:profiles(${PROFILE_SELECT})`;

/**
 * GET — return approved comments for a kill, plus the current user's own
 * pending comments (so they see immediate feedback while the Haiku worker
 * processes them in the background).
 *
 * Two queries are needed because the public RLS policy on `comments` only
 * exposes `moderation_status='approved'`. The pending slice runs scoped to
 * `auth.uid() = user_id`, which the "Own comment update" policy already
 * permits at SELECT time once we attach the user JWT.
 *
 * Wave 7 (Agent AF) — also returns per-comment vote metadata :
 *   * `upvotes`         : running score (SUM(vote_value), can be negative)
 *   * `downvote_count`  : count of -1 votes (for Wilson sort + UI breakdown)
 *   * `user_vote`       : the current user's vote on each comment (-1|0|1),
 *                         null when anonymous. Renders the active state of
 *                         the up/down arrows.
 *
 * The vote enrichment happens in one batched fetch keyed by the visible
 * comment ids, so adding it doesn't change round-trip count for typical
 * sheet renders (≤ 50 comments).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data: { user } } = await supabase.auth.getUser();

  const approvedQ = supabase
    .from("comments")
    .select(COMMENT_SELECT)
    .eq("kill_id", id)
    .eq("is_deleted", false)
    .eq("moderation_status", "approved")
    .order("created_at", { ascending: false });

  const pendingQ = user
    ? supabase
        .from("comments")
        .select(COMMENT_SELECT)
        .eq("kill_id", id)
        .eq("is_deleted", false)
        .eq("moderation_status", "pending")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
    : null;

  const [approvedRes, pendingRes] = await Promise.all([
    approvedQ,
    pendingQ ?? Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null }),
  ]);

  if (approvedRes.error) {
    return NextResponse.json({ error: approvedRes.error.message }, { status: 500 });
  }

  // Tag pending rows so the client can render a "en modération…" pill.
  type CommentRow = Record<string, unknown> & { id: string; parent_id: string | null };
  const pending: CommentRow[] = ((pendingRes.data as CommentRow[] | null) ?? []).map((c) => ({
    ...c,
    _pending: true,
  }));
  const merged: CommentRow[] = [...pending, ...((approvedRes.data as CommentRow[] | null) ?? [])];

  // ─── Wave 7 vote enrichment ──────────────────────────────────────
  // Two batched queries against comment_votes for the visible ids :
  //   1. SUM the -1 votes per comment_id → `downvote_count`
  //   2. Pull the user's own (comment_id → vote_value) when logged in
  // Both are O(votes-on-visible-comments) which is tiny for typical
  // sheet renders.
  const visibleIds = merged.map((c) => String(c.id));
  const downvoteCountById = new Map<string, number>();
  const userVoteById = new Map<string, -1 | 1>();

  if (visibleIds.length > 0) {
    const downvotesRes = await supabase
      .from("comment_votes")
      .select("comment_id")
      .eq("vote_value", -1)
      .in("comment_id", visibleIds);
    for (const row of (downvotesRes.data ?? []) as { comment_id: string }[]) {
      downvoteCountById.set(
        row.comment_id,
        (downvoteCountById.get(row.comment_id) ?? 0) + 1,
      );
    }

    if (user) {
      const userVotesRes = await supabase
        .from("comment_votes")
        .select("comment_id, vote_value")
        .eq("user_id", user.id)
        .in("comment_id", visibleIds);
      for (const row of (userVotesRes.data ?? []) as {
        comment_id: string;
        vote_value: number;
      }[]) {
        if (row.vote_value === -1 || row.vote_value === 1) {
          userVoteById.set(row.comment_id, row.vote_value);
        }
      }
    }
  }

  const enriched: CommentRow[] = merged.map((c) => {
    const cid = String(c.id);
    return {
      ...c,
      downvote_count: downvoteCountById.get(cid) ?? 0,
      user_vote: userVoteById.get(cid) ?? 0,
    };
  });

  const topLevel = enriched.filter((c) => !c.parent_id);
  const replies = enriched.filter((c) => c.parent_id);

  const threaded = topLevel.map((comment) => ({
    ...comment,
    replies: replies.filter((r) => r.parent_id === comment.id),
  }));

  return NextResponse.json(threaded);
}

/**
 * POST — insert a new comment as `pending`. The Haiku moderator daemon
 * (worker/modules/moderator.py, polled every 180s) flips it to
 * `approved` / `flagged` / `rejected`.
 *
 * The author still sees their own comment immediately via GET's pending
 * branch — the rest of the world waits for Haiku.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const body = await request.json();
  const { text, parentId } = body;

  if (!text || text.trim().length === 0) {
    return NextResponse.json({ error: "Commentaire vide" }, { status: 400 });
  }

  if (text.length > 500) {
    return NextResponse.json({ error: "Commentaire trop long (max 500)" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("comments")
    .insert({
      kill_id: id,
      user_id: user.id,
      parent_id: parentId || null,
      content: text.trim(),
      moderation_status: "pending",
    })
    .select(COMMENT_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Echo the pending flag so the client knows to badge it.
  return NextResponse.json({ ...data, _pending: true });
}
