import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

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
  const score = body.score;

  if (!score || score < 1 || score > 5) {
    return NextResponse.json({ error: "Score invalide (1-5)" }, { status: 400 });
  }

  // Upsert rating
  const { error } = await supabase.from("ratings").upsert(
    {
      kill_id: id,
      user_id: user.id,
      score,
    },
    { onConflict: "kill_id,user_id" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get updated kill rating
  const { data: kill } = await supabase
    .from("kills")
    .select("avg_rating, rating_count")
    .eq("id", id)
    .single();

  return NextResponse.json({
    avg_rating: kill?.avg_rating ?? 0,
    rating_count: kill?.rating_count ?? 0,
    user_score: score,
  });
}
