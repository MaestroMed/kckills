import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

const PROFILE_SELECT = "id, discord_username, discord_avatar_url, badges";
const COMMENT_SELECT = `*, profile:profiles(${PROFILE_SELECT})`;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("comments")
    .select(COMMENT_SELECT)
    .eq("kill_id", id)
    .eq("is_deleted", false)
    .eq("moderation_status", "approved")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const topLevel = (data ?? []).filter((c) => !c.parent_id);
  const replies = (data ?? []).filter((c) => c.parent_id);

  const threaded = topLevel.map((comment) => ({
    ...comment,
    replies: replies.filter((r) => r.parent_id === comment.id),
  }));

  return NextResponse.json(threaded);
}

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

  // TODO(moderation): route through Claude Haiku before approval per spec §5.8.
  // Auto-approve until the moderation worker is wired in — otherwise the RLS
  // policy hides every comment and the feature is invisible.
  const { data, error } = await supabase
    .from("comments")
    .insert({
      kill_id: id,
      user_id: user.id,
      parent_id: parentId || null,
      content: text.trim(),
      moderation_status: "approved",
    })
    .select(COMMENT_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
