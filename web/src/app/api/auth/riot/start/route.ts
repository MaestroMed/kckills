/**
 * GET /api/auth/riot/start — kicks off the optional Riot Sign-On linking
 * flow for an already-Discord-authenticated user.
 *
 * Flow :
 *   1. Verify the caller has a Supabase session (Discord OAuth must be
 *      done first — Riot is a SECONDARY link, not a primary auth).
 *   2. Generate PKCE verifier + challenge + opaque state.
 *   3. Drop a signed httpOnly cookie carrying { state, verifier } —
 *      consumed by the callback route.
 *   4. 302 redirect to https://auth.riotgames.com/authorize?...
 *
 * If RIOT_CLIENT_ID / RIOT_CLIENT_SECRET / NEXT_PUBLIC_APP_URL aren't
 * set we return a 503 JSON error instead of crashing — the settings
 * card uses the same env-presence signal to render an "indisponible"
 * disabled state, but a direct hit on this URL still gets a useful
 * response.
 */

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  RIOT_PKCE_COOKIE,
  RIOT_PKCE_COOKIE_MAX_AGE,
  encodePkceCookie,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  getRiotOAuthConfig,
} from "@/lib/auth/riot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const cfg = getRiotOAuthConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: "RIOT_CLIENT_ID not configured" },
      { status: 503 },
    );
  }

  // requireAuth() — must be logged in via Discord first.
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Bounce to /login with a hint so the UX explains what happened.
    const loginUrl = `${cfg.appUrl}/login?next=/settings`;
    return NextResponse.redirect(loginUrl);
  }

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();

  // Build the Riot authorize URL. `scope=openid` is the minimum required
  // to get a usable id_token + access_token for account-v1.
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const authorizeUrl = `https://auth.riotgames.com/authorize?${params.toString()}`;

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(RIOT_PKCE_COOKIE, encodePkceCookie({ state, verifier }), {
    path: "/",
    maxAge: RIOT_PKCE_COOKIE_MAX_AGE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  return response;
}
