import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const body = await request.json();
  const { url, title, platform } = body;

  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    return NextResponse.json({ error: "URL invalide" }, { status: 400 });
  }

  const validPlatforms = ["youtube", "tiktok", "twitter"];
  const safePlatform = validPlatforms.includes(platform) ? platform : "youtube";

  const { data, error } = await supabase
    .from("community_clips")
    .insert({
      submitted_by: user.id,
      external_url: url.trim(),
      title: (title || "").trim().slice(0, 200) || null,
      platform: safePlatform,
      approved: false,
    })
    .select("id, external_url, title, platform, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function GET() {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("community_clips")
    .select("id, external_url, title, platform, upvotes, created_at")
    .eq("approved", true)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
