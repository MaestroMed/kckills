import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("comments")
    .select("*, profile:profiles(id, username, avatar_url, badges)")
    .eq("kill_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Nest replies under parents
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

  if (text.length > 2000) {
    return NextResponse.json({ error: "Commentaire trop long (max 2000)" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("comments")
    .insert({
      kill_id: id,
      user_id: user.id,
      parent_id: parentId || null,
      body: text.trim(),
    })
    .select("*, profile:profiles(id, username, avatar_url, badges)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
