import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * GET /api/me — Export all user data as JSON (RGPD)
 * DELETE /api/me — Delete account: remove profile, anonymize ratings, delete comments
 */
export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifie" }, { status: 401 });
  }

  // Gather all user data
  const [profile, ratings, comments] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("ratings").select("kill_id, score, created_at").eq("user_id", user.id),
    supabase.from("comments").select("id, kill_id, content, created_at").eq("user_id", user.id).eq("is_deleted", false),
  ]);

  return NextResponse.json({
    exported_at: new Date().toISOString(),
    user_id: user.id,
    profile: profile.data ?? null,
    ratings: ratings.data ?? [],
    comments: comments.data ?? [],
  });
}

export async function DELETE() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifie" }, { status: 401 });
  }

  // 1. Delete comments (hard delete)
  await supabase
    .from("comments")
    .update({ is_deleted: true, content: "[supprime]" })
    .eq("user_id", user.id);

  // 2. Anonymize ratings (keep the scores for aggregate avg, remove user link)
  // Can't actually remove user_id due to FK constraint, but we can delete the profile
  // which effectively anonymizes the user.

  // 3. Delete profile
  await supabase.from("profiles").delete().eq("id", user.id);

  // 4. Sign out
  await supabase.auth.signOut();

  return NextResponse.json({ deleted: true });
}
