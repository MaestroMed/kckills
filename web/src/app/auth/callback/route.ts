import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Accept both ?next= (the new /login flow) and ?redirect= (legacy).
  // Only allow in-site paths to prevent open-redirect attacks.
  const rawNext = searchParams.get("next") ?? searchParams.get("redirect") ?? "/";
  const redirectTo = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (!code) {
    return NextResponse.redirect(`${origin}${redirectTo}`);
  }

  const supabase = await createServerSupabase();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const discordId = String(meta.provider_id ?? meta.sub ?? user.id);
    const discordIdHash = createHash("sha256").update(discordId).digest("hex");
    const discordUsername =
      (meta.user_name as string | undefined) ??
      (meta.preferred_username as string | undefined) ??
      (meta.name as string | undefined) ??
      (meta.full_name as string | undefined) ??
      null;
    const discordAvatarUrl = (meta.avatar_url as string | undefined) ?? null;

    await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          discord_username: discordUsername,
          discord_avatar_url: discordAvatarUrl,
          discord_id_hash: discordIdHash,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "id", ignoreDuplicates: false }
      );
  }

  return NextResponse.redirect(`${origin}${redirectTo}`);
}
