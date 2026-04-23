import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * POST   /api/kills/[id]/like   — toggle ON the user's like.
 * DELETE /api/kills/[id]/like   — toggle OFF.
 *
 * Implementation: a "like" is just a rating with score=5. The /rate
 * endpoint already exists for the granular 1-5 star UI — this `/like`
 * is a quick-tap shortcut for the TikTok-grade revamp where the
 * primary action is heart-tap, not star-pick.
 *
 * Auth: 401 if not logged in (the InlineAuthPrompt picks this up
 * client-side and shows the Discord OAuth popup instead of crashing).
 *
 * Response shape (200 OK):
 *   {
 *     liked: boolean,        // user's current like state after toggle
 *     avg_rating: number|null,
 *     rating_count: number,
 *   }
 */

interface RpcKillSummary {
  avg_rating: number | null;
  rating_count: number | null;
}

async function refreshSummary(
  sb: Awaited<ReturnType<typeof createServerSupabase>>,
  killId: string,
): Promise<RpcKillSummary> {
  const { data } = await sb
    .from("kills")
    .select("avg_rating, rating_count")
    .eq("id", killId)
    .maybeSingle();
  return {
    avg_rating: (data?.avg_rating as number | null) ?? null,
    rating_count: (data?.rating_count as number | null) ?? 0,
  };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  // Upsert score=5. The trigger fn_update_kill_rating recomputes
  // avg_rating + rating_count automatically.
  const { error } = await sb.from("ratings").upsert(
    { kill_id: id, user_id: user.id, score: 5 },
    { onConflict: "kill_id,user_id" },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const summary = await refreshSummary(sb, id);
  return NextResponse.json({ liked: true, ...summary });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "auth_required" }, { status: 401 });
  }

  const { error } = await sb
    .from("ratings")
    .delete()
    .eq("kill_id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const summary = await refreshSummary(sb, id);
  return NextResponse.json({ liked: false, ...summary });
}

/** GET → returns the current user's like state (used on hydrate to
 *  paint the heart filled vs outline without a flash of wrong state). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = await createServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();

  const summary = await refreshSummary(sb, id);
  if (!user) {
    return NextResponse.json({ liked: false, ...summary });
  }
  const { data } = await sb
    .from("ratings")
    .select("score")
    .eq("kill_id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  // We treat ANY existing rating as "liked" for the heart UI — the
  // 5-star sheet remains the precision tool for users who really want
  // to differentiate.
  return NextResponse.json({ liked: data != null, ...summary });
}
