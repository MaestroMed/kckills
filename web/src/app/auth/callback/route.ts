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

  // Detect signup vs login : if the profile row doesn't exist yet, this
  // is a first-time signup. Otherwise it's a returning login. We compute
  // BEFORE the upsert below so the check is accurate.
  let isSignup = false;

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

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    isSignup = !existingProfile;

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

  // Drop a one-shot cookie that the next page load picks up to fire the
  // analytics event client-side. Server-side tracking would bypass the
  // anonymous_user_id / session_id chain, so we defer to the client.
  // The cookie is consumed + cleared by AuthEventTracker on first read.
  const response = NextResponse.redirect(`${origin}${redirectTo}`);
  if (user) {
    response.cookies.set("kc_auth_event", isSignup ? "auth.signup" : "auth.login", {
      path: "/",
      maxAge: 60, // self-clears within 60s if the next page never loads
      sameSite: "lax",
      httpOnly: false, // needs to be readable by client JS
    });
  }
  return response;
}
