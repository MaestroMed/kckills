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
  likeCount: number;
}

export interface KillLikeError {
  ok: false;
  error: string;
  authRequired?: boolean;
}

/**
 * Toggle the user's binary "like" on a kill.
 *
 * Wave 36 (migr 080) — the like now lives in the dedicated `likes` table,
 * NOT as a ratings.score=5 row. Previously a like and a 1-5 star rating
 * shared the SAME ratings row (UNIQUE kill_id,user_id) and mutually
 * overwrote; they are now fully independent. The count returned/read here
 * is kills.like_count (maintained by trg_like_change). 1-5 ratings go
 * through `rateKill` below and feed avg_rating/rating_count separately.
 *
 * `desired = true`  → insert into likes (idempotent on conflict)
 * `desired = false` → delete the like row
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
    const { error } = await supabase.from("likes").upsert(
      { kill_id: killId, user_id: user.id },
      { onConflict: "kill_id,user_id", ignoreDuplicates: true },
    );
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("likes")
      .delete()
      .eq("kill_id", killId)
      .eq("user_id", user.id);
    if (error) return { ok: false, error: error.message };
  }

  // Read back canonical count — trg_like_change fired synchronously above.
  const { data } = await supabase
    .from("kills")
    .select("like_count")
    .eq("id", killId)
    .maybeSingle();

  return {
    ok: true,
    liked: desired,
    likeCount: (data?.like_count as number | null) ?? 0,
  };
}

/** Hydrate the heart on mount — reads the dedicated likes table. */
export async function getKillLikeState(
  killId: string,
): Promise<{ liked: boolean; likeCount: number }> {
  if (!UUID_RE.test(killId)) return { liked: false, likeCount: 0 };

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: kill } = await supabase
    .from("kills")
    .select("like_count")
    .eq("id", killId)
    .maybeSingle();
  const likeCount = (kill?.like_count as number | null) ?? 0;

  if (!user) return { liked: false, likeCount };

  const { data } = await supabase
    .from("likes")
    .select("id")
    .eq("kill_id", killId)
    .eq("user_id", user.id)
    .maybeSingle();

  return { liked: data != null, likeCount };
}

/**
 * Cast / update the user's 1-5 STAR rating on a kill (Wave 36).
 *
 * This is the precision rating, independent of the binary like above. It
 * upserts the user's row in `ratings` (UNIQUE kill_id,user_id); the
 * existing fn_update_kill_rating trigger recomputes avg_rating +
 * rating_count, which drive the Wilson feed score. `score = 0` clears the
 * rating (delete), so the UI can toggle a star off.
 */
export async function rateKill(
  killId: string,
  score: number,
): Promise<{ ok: true; avgRating: number; ratingCount: number } | KillLikeError> {
  if (!UUID_RE.test(killId)) {
    return { ok: false, error: "Identifiant invalide" };
  }
  if (!Number.isInteger(score) || score < 0 || score > 5) {
    return { ok: false, error: "Note invalide (0-5)" };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Connecte-toi pour noter", authRequired: true };
  }

  if (score === 0) {
    const { error } = await supabase
      .from("ratings")
      .delete()
      .eq("kill_id", killId)
      .eq("user_id", user.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from("ratings").upsert(
      { kill_id: killId, user_id: user.id, score },
      { onConflict: "kill_id,user_id" },
    );
    if (error) return { ok: false, error: error.message };
  }

  // fn_update_kill_rating fired synchronously above.
  const { data } = await supabase
    .from("kills")
    .select("avg_rating, rating_count")
    .eq("id", killId)
    .maybeSingle();

  return {
    ok: true,
    avgRating: (data?.avg_rating as number | null) ?? 0,
    ratingCount: (data?.rating_count as number | null) ?? 0,
  };
}
