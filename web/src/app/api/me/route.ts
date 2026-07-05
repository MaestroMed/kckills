import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * GET /api/me — Export all user data as JSON (RGPD)
 * DELETE /api/me — Full account erasure (RGPD art. 17).
 *
 * Audit 2026-07-02 : the previous DELETE only removed the profile row —
 * the auth.users record (Discord identity, OAuth email) and the ratings
 * survived, so a "deleted" user stayed identifiable in the database.
 * Every FK to auth.users is ON DELETE CASCADE or SET NULL (verified
 * across all 82 migrations), so deleting the auth user itself is the
 * complete + atomic erasure: profiles, ratings, comments, likes,
 * comment_votes, bookmarks, push subscriptions… all follow.
 */
export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifie" }, { status: 401 });
  }

  // Gather all user data. Explicit column list — migration 083 revoked
  // table-wide SELECT for authenticated (the discord_id_hash /
  // riot_puuid_hash columns are derived values, not personal data the
  // export needs, and `select("*")` would now be rejected).
  const [profile, ratings, comments] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, discord_username, discord_avatar_url, riot_summoner_name, riot_tag, riot_rank, riot_top_champions, riot_linked_at, total_ratings, total_comments, badges, created_at, last_seen_at",
      )
      .eq("id", user.id)
      .maybeSingle(),
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

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !url) {
    // Without the service key we cannot erase auth.users — refuse
    // loudly rather than pretend the account is gone (the old bug).
    console.error("[api/me] DELETE: SUPABASE_SERVICE_ROLE_KEY missing — cannot erase account");
    return NextResponse.json(
      { error: "Suppression indisponible — contacte l'admin" },
      { status: 503 },
    );
  }

  // Neutralize comment CONTENT first: comments cascade-delete with the
  // user, but replies referencing them (parent_id) may keep quoted
  // context in clients — blanking is cheap defence-in-depth.
  await supabase
    .from("comments")
    .update({ is_deleted: true, content: "[supprime]" })
    .eq("user_id", user.id);

  // Full erasure: deleting the auth user cascades to every dependent
  // table (profiles, ratings, likes, comment_votes, bookmarks, …).
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) {
    console.error("[api/me] DELETE: auth.admin.deleteUser failed:", delErr.message);
    return NextResponse.json(
      { error: "La suppression a echoue — reessaie ou contacte l'admin" },
      { status: 500 },
    );
  }

  // Session is now orphaned — clear the cookies.
  await supabase.auth.signOut();

  return NextResponse.json({ deleted: true });
}
