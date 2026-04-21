import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

const PROFILE_SELECT = "id, discord_username, discord_avatar_url, badges";
const COMMENT_SELECT = `*, profile:profiles(${PROFILE_SELECT})`;

/**
 * GET — return approved comments for a kill, plus the current user's own
 * pending comments (so they see immediate feedback while the Haiku worker
 * processes them in the background).
 *
 * Two queries are needed because the public RLS policy on `comments` only
 * exposes `moderation_status='approved'`. The pending slice runs scoped to
 * `auth.uid() = user_id`, which the "Own comment update" policy already
 * permits at SELECT time once we attach the user JWT.
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

  const topLevel = merged.filter((c) => !c.parent_id);
  const replies = merged.filter((c) => c.parent_id);

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
