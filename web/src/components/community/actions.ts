"use server";

/**
 * Server Actions for community interactions (votes / reports / submits).
 *
 * Why Server Actions instead of API routes
 * ────────────────────────────────────────
 * Migrating client → server mutations from `fetch('/api/...')` to
 * Server Actions buys us :
 *   * Type-safe contract — the action signature IS the wire shape, no
 *     JSON.stringify / response.json() dance, no zod schemas to maintain.
 *   * Less boilerplate — the client passes typed args directly.
 *   * Built-in CSRF protection (Next 16 / React 19).
 *   * Co-located logic — actions live next to the components that use
 *     them, easier to refactor as a unit.
 *   * Automatic `revalidatePath` / `revalidateTag` — no manual
 *     `router.refresh()` plumbing after a mutation.
 *
 * This is the first Server Action in the codebase (Wave 13b POC, 2026-04-28).
 * The migration roadmap in `docs/sota-migration-roadmap.md` lists the other
 * 25 routes that should follow.
 */

import { createServerSupabase } from "@/lib/supabase/server";

export type CommentVoteValue = -1 | 0 | 1;

export interface CommentVoteResult {
  ok: true;
  upvotes: number;
  downvotes: number;
  userVote: CommentVoteValue;
}

export interface CommentVoteError {
  ok: false;
  error: string;
  /** True when the user is unauthenticated — UI should surface a login prompt. */
  authRequired?: boolean;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reddit-style upvote / downvote on a comment.
 *
 *   vote = +1  → upvote (insert if absent, update if previously -1)
 *   vote = -1  → downvote (insert if absent, update if previously +1)
 *   vote = 0   → remove the user's vote (DELETE the row)
 *
 * The trigger `trg_comment_votes_recompute` (migration 038) keeps
 * `comments.upvotes` (the running SUM(vote_value)) in sync — we just
 * read it back after the write to return the canonical numbers and
 * avoid client-side drift on rapid re-votes.
 */
export async function voteOnComment(
  commentId: string,
  vote: CommentVoteValue,
): Promise<CommentVoteResult | CommentVoteError> {
  if (!UUID_RE.test(commentId)) {
    return { ok: false, error: "Identifiant invalide" };
  }

  if (vote !== -1 && vote !== 0 && vote !== 1) {
    return {
      ok: false,
      error: "Vote invalide (attendu : -1, 0 ou 1)",
    };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Connecte-toi pour voter", authRequired: true };
  }

  if (vote === 0) {
    const { error: deleteErr } = await supabase
      .from("comment_votes")
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", user.id);
    if (deleteErr) {
      return { ok: false, error: deleteErr.message };
    }
  } else {
    const { error: upsertErr } = await supabase
      .from("comment_votes")
      .upsert(
        {
          comment_id: commentId,
          user_id: user.id,
          vote_value: vote,
        },
        { onConflict: "comment_id,user_id" },
      );
    if (upsertErr) {
      return { ok: false, error: upsertErr.message };
    }
  }

  // Read back canonical state. The recompute trigger fires synchronously
  // on the write above, so `comments.upvotes` is already up to date.
  const [killRes, downvotesRes] = await Promise.all([
    supabase
      .from("comments")
      .select("upvotes")
      .eq("id", commentId)
      .maybeSingle(),
    supabase
      .from("comment_votes")
      .select("id", { count: "exact", head: true })
      .eq("comment_id", commentId)
      .eq("vote_value", -1),
  ]);

  return {
    ok: true,
    upvotes: (killRes.data?.upvotes as number | null) ?? 0,
    downvotes: downvotesRes.count ?? 0,
    userVote: vote,
  };
}

// ─── Kill like (TikTok-grade heart toggle) ────────────────────────────

export interface KillLikeResult {
  ok: true;
  liked: boolean;
  ratingCount: number;
}

export interface KillLikeError {
  ok: false;
  error: string;
  authRequired?: boolean;
}

/**
 * Toggle the user's "like" on a kill — implemented as a rating with
 * score=5 (matches the legacy /api/kills/[id]/like behaviour). The
 * 5-star precision UI remains available via the RatingSheet.
 *
 * `desired = true`  → upsert(score=5)
 * `desired = false` → delete the row
 */
export async function toggleKillLike(
  killId: string,
  desired: boolean,
): Promise<KillLikeResult | KillLikeError> {
  if (!UUID_RE.test(killId)) {
    return { ok: false, error: "Identifiant invalide" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Connecte-toi pour liker", authRequired: true };
  }

  if (desired) {
    const { error } = await supabase.from("ratings").upsert(
      { kill_id: killId, user_id: user.id, score: 5 },
      { onConflict: "kill_id,user_id" },
    );
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("ratings")
      .delete()
      .eq("kill_id", killId)
      .eq("user_id", user.id);
    if (error) return { ok: false, error: error.message };
  }

  // Read back canonical count — the trigger fn_update_kill_rating has
  // already fired synchronously on the write above.
  const { data } = await supabase
    .from("kills")
    .select("rating_count")
    .eq("id", killId)
    .maybeSingle();

  return {
    ok: true,
    liked: desired,
    ratingCount: (data?.rating_count as number | null) ?? 0,
  };
}

/** Hydrate the heart on mount (was GET /api/kills/[id]/like). */
export async function getKillLikeState(
  killId: string,
): Promise<{ liked: boolean; ratingCount: number }> {
  if (!UUID_RE.test(killId)) return { liked: false, ratingCount: 0 };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: kill } = await supabase
    .from("kills")
    .select("rating_count")
    .eq("id", killId)
    .maybeSingle();
  const ratingCount = (kill?.rating_count as number | null) ?? 0;

  if (!user) return { liked: false, ratingCount };

  const { data } = await supabase
    .from("ratings")
    .select("score")
    .eq("kill_id", killId)
    .eq("user_id", user.id)
    .maybeSingle();

  // Treat ANY existing rating as "liked" for the heart UI — same rule
  // as the legacy GET /api/kills/[id]/like handler.
  return { liked: data != null, ratingCount };
}
