/**
 * GET /api/auth/riot/callback — completes the Riot Sign-On linking flow.
 *
 * Receives ?code=...&state=... from Riot, validates the signed cookie,
 * exchanges the code for tokens, calls the three Riot API endpoints we
 * need (account-v1 / league-v4 / champion-mastery-v4), then UPDATEs
 * the profile row with HASHED PUUID + summoner name + tag + rank +
 * top 5 champions. Drops a one-shot analytics cookie that the client
 * picks up on the next page load (mirrors the Discord auth pattern).
 *
 * Failure modes — all surface as a redirect back to /settings with a
 * `?riot_error=...` query param the UI can render without leaking
 * internals :
 *   - missing code/state                  -> riot_error=invalid_callback
 *   - state mismatch / cookie expired     -> riot_error=state_mismatch
 *   - token exchange failed               -> riot_error=token_exchange
 *   - account fetch failed                -> riot_error=account_fetch
 *   - missing RIOT_API_KEY (rank/mastery) -> riot_error=api_key
 *   - profile UPDATE failed               -> riot_error=db_update
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  RIOT_PKCE_COOKIE,
  decodePkceCookie,
  exchangeCodeForTokens,
  fetchRiotAccount,
  fetchRiotChampionMastery,
  fetchRiotLeagueEntries,
  formatLeagueRank,
  getRiotOAuthConfig,
  hashPuuid,
  shapeChampionsForStorage,
} from "@/lib/auth/riot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redirectToSettings(origin: string, search: Record<string, string>) {
  const url = new URL("/settings", origin);
  for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  // Clear the PKCE cookie regardless of outcome.
  res.cookies.set(RIOT_PKCE_COOKIE, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}

export async function GET(request: NextRequest) {
  const cfg = getRiotOAuthConfig();
  const origin = cfg?.appUrl ?? new URL(request.url).origin;

  if (!cfg) {
    return redirectToSettings(origin, { riot_error: "not_configured" });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  if (errorParam) {
    // User declined the consent screen on Riot's side.
    return redirectToSettings(origin, { riot_error: "user_denied" });
  }
  if (!code || !state) {
    return redirectToSettings(origin, { riot_error: "invalid_callback" });
  }

  const cookieValue = request.cookies.get(RIOT_PKCE_COOKIE)?.value;
  const pkce = decodePkceCookie(cookieValue);
  if (!pkce || pkce.state !== state) {
    return redirectToSettings(origin, { riot_error: "state_mismatch" });
  }

  // Verify the user is still logged in via Discord.
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return redirectToSettings(origin, { riot_error: "session_expired" });
  }

  // 1. Exchange code -> tokens
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, pkce.verifier, cfg);
  } catch (err) {
    console.warn("[/api/auth/riot/callback] token exchange threw:", err instanceof Error ? err.message : err);
    return redirectToSettings(origin, { riot_error: "token_exchange" });
  }

  // 2. Account-v1 (Bearer auth)
  let account;
  try {
    account = await fetchRiotAccount(tokens.access_token);
  } catch (err) {
    console.warn("[/api/auth/riot/callback] account fetch threw:", err instanceof Error ? err.message : err);
    return redirectToSettings(origin, { riot_error: "account_fetch" });
  }

  // 3. Server API key for ranked + mastery
  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey || apiKey === "your-riot-api-key") {
    // Without a real API key we can still link the account (PUUID +
    // summoner name + tag) but rank/mastery stay empty. Better than
    // failing the whole flow — surface a soft warning via the redirect.
    const puuidHash = hashPuuid(account.puuid);
    const update = {
      riot_puuid_hash: puuidHash,
      riot_summoner_name: account.gameName,
      riot_tag: account.tagLine,
      riot_rank: null as string | null,
      riot_top_champions: [] as unknown[],
      riot_linked_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
    if (error) {
      console.warn("[/api/auth/riot/callback] profile update (no api key) failed:", error.message);
      return redirectToSettings(origin, { riot_error: "db_update" });
    }
    await logAdminAction(supabase, user.id, "no_api_key");
    return redirectToSettings(origin, { riot_linked: "true", riot_warn: "no_api_key" });
  }

  // 4. Ranked + mastery in parallel — independent API calls.
  const [entriesResult, masteryResult] = await Promise.allSettled([
    fetchRiotLeagueEntries(account.puuid, apiKey),
    fetchRiotChampionMastery(account.puuid, apiKey, 5),
  ]);

  const entries =
    entriesResult.status === "fulfilled" ? entriesResult.value : [];
  const mastery =
    masteryResult.status === "fulfilled" ? masteryResult.value : [];

  if (entriesResult.status === "rejected") {
    console.warn(
      "[/api/auth/riot/callback] league entries failed (continuing without rank):",
      entriesResult.reason instanceof Error
        ? entriesResult.reason.message
        : entriesResult.reason,
    );
  }
  if (masteryResult.status === "rejected") {
    console.warn(
      "[/api/auth/riot/callback] mastery failed (continuing without champions):",
      masteryResult.reason instanceof Error
        ? masteryResult.reason.message
        : masteryResult.reason,
    );
  }

  const puuidHash = hashPuuid(account.puuid);
  const rankLabel = formatLeagueRank(entries);
  const champions = shapeChampionsForStorage(mastery);

  const update = {
    riot_puuid_hash: puuidHash,
    riot_summoner_name: account.gameName,
    riot_tag: account.tagLine,
    riot_rank: rankLabel,
    riot_top_champions: champions,
    riot_linked_at: new Date().toISOString(),
  };

  const { error: updErr } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", user.id);

  if (updErr) {
    console.warn("[/api/auth/riot/callback] profile update failed:", updErr.message);
    return redirectToSettings(origin, { riot_error: "db_update" });
  }

  await logAdminAction(supabase, user.id, rankLabel ?? "unranked");

  // Drop the one-shot analytics cookie — the client AuthEventTracker
  // (or any reader) flushes it on next render.
  const res = redirectToSettings(origin, { riot_linked: "true" });
  res.cookies.set("kc_auth_event", "auth.riot_linked", {
    path: "/",
    maxAge: 60,
    sameSite: "lax",
    httpOnly: false, // readable by client JS
  });
  return res;
}

/**
 * Best-effort audit log. We never block the success path on this — the
 * admin_actions insert will be silently dropped on RLS denial when the
 * caller doesn't have service role, which is fine for the optional
 * Riot link flow (the user_id is still on profiles for forensics).
 */
async function logAdminAction(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  userId: string,
  notes: string,
): Promise<void> {
  try {
    await supabase.from("admin_actions").insert({
      actor_id: userId,
      actor_label: "user",
      action: "auth.riot_linked",
      entity_type: "profile",
      entity_id: userId,
      notes,
    });
  } catch {
    // Audit failures must not break the user-facing flow.
  }
}
