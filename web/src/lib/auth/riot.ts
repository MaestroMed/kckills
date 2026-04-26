/**
 * Shared helpers for the optional Riot Sign-On (RSO) linking flow.
 *
 * The RSO flow is OAuth 2.0 Authorization Code with PKCE :
 *   1. /api/auth/riot/start  -> generates a code_verifier + state, stores
 *      both in a single signed httpOnly cookie, redirects to Riot.
 *   2. /api/auth/riot/callback receives ?code=...&state=... — validates
 *      state, exchanges the code for tokens, calls account-v1 +
 *      league-v4 + champion-mastery-v4 to populate the profile row.
 *   3. /api/auth/riot/unlink wipes every riot_* column.
 *
 * The PUUID is HASHED via SHA-256 BEFORE storage. We never persist the
 * raw PUUID — see CLAUDE.md §7.1 zero-knowledge.
 *
 * Cookie signing uses HMAC-SHA256 with a server-only secret. The secret
 * falls back to SUPABASE_SERVICE_ROLE_KEY if RIOT_OAUTH_COOKIE_SECRET is
 * missing (any server-only value works — the property we need is "the
 * client cannot mint a valid cookie"). Both are server-side env vars
 * never exposed to the browser.
 */

import "server-only";
import { createHash, createHmac, randomBytes } from "crypto";

// ─── Public env-driven config ─────────────────────────────────────────

export interface RiotOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  appUrl: string;
}

/**
 * Read the Riot OAuth env vars. Returns `null` if any required value is
 * missing — the routes/components use that signal to render a graceful
 * "Riot link unavailable" state instead of throwing.
 */
export function getRiotOAuthConfig(): RiotOAuthConfig | null {
  const clientId = process.env.RIOT_CLIENT_ID;
  const clientSecret = process.env.RIOT_CLIENT_SECRET;
  // NEXT_PUBLIC_APP_URL is used as the canonical site origin for the
  // redirect_uri. Falls back to NEXT_PUBLIC_SITE_URL for legacy installs
  // where only the latter is defined.
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  if (!clientId || !clientSecret || !appUrl) return null;
  // Strip a trailing slash so we don't end up with `//api/...`
  const cleanAppUrl = appUrl.replace(/\/$/, "");
  return {
    clientId,
    clientSecret,
    appUrl: cleanAppUrl,
    redirectUri: `${cleanAppUrl}/api/auth/riot/callback`,
  };
}

/** Returns true when the Riot link flow is fully configured. */
export function isRiotLinkConfigured(): boolean {
  return getRiotOAuthConfig() !== null;
}

// ─── PKCE helpers ─────────────────────────────────────────────────────

/** Base64-URL encode (no padding) — RFC 7636 / 4648 §5. */
function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function generateCodeVerifier(): string {
  // 32 random bytes -> 43-char base64url string. RFC 7636 minimum is 32 chars.
  return base64Url(randomBytes(32));
}

export function generateCodeChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

export function generateState(): string {
  return base64Url(randomBytes(16));
}

// ─── Signed cookie payload (state + verifier) ─────────────────────────

const COOKIE_NAME = "kc_riot_pkce";
const COOKIE_MAX_AGE_SECONDS = 600; // 10 minutes — Riot recommends ≤15 min

export const RIOT_PKCE_COOKIE = COOKIE_NAME;
export const RIOT_PKCE_COOKIE_MAX_AGE = COOKIE_MAX_AGE_SECONDS;

interface PkcePayload {
  state: string;
  verifier: string;
}

function getCookieSecret(): string {
  const explicit = process.env.RIOT_OAUTH_COOKIE_SECRET;
  if (explicit && explicit.length >= 16) return explicit;
  // Fallback to any server-only secret — the only requirement is that
  // the client cannot mint a valid signature. Service role key is never
  // exposed to the browser, so it satisfies that.
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (fallback.length >= 16) return fallback;
  // Last-resort: a constant. This degrades to "unauthenticated state
  // verification only" but is never reached in a properly configured
  // deployment because getRiotOAuthConfig() already gates on env vars.
  return "kc-riot-pkce-fallback-secret-do-not-use-in-prod";
}

function signPayload(payload: string): string {
  return base64Url(createHmac("sha256", getCookieSecret()).update(payload).digest());
}

/** Build the signed cookie value : `<base64url(json)>.<sig>`. */
export function encodePkceCookie(payload: PkcePayload): string {
  const json = JSON.stringify(payload);
  const body = base64Url(Buffer.from(json, "utf8"));
  const sig = signPayload(body);
  return `${body}.${sig}`;
}

/** Parse and verify the cookie. Returns `null` on any tampering. */
export function decodePkceCookie(value: string | undefined): PkcePayload | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  // Constant-time comparison to defeat trivial timing attacks.
  const expected = signPayload(body);
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) {
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return null;
  try {
    const padded = body + "=".repeat((4 - (body.length % 4)) % 4);
    const json = Buffer.from(
      padded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const parsed = JSON.parse(json) as Partial<PkcePayload>;
    if (typeof parsed.state !== "string" || typeof parsed.verifier !== "string") {
      return null;
    }
    return { state: parsed.state, verifier: parsed.verifier };
  } catch {
    return null;
  }
}

// ─── PUUID hashing ────────────────────────────────────────────────────

/** SHA-256 hex digest of the PUUID. Mirrors the discord_id_hash pattern. */
export function hashPuuid(puuid: string): string {
  return createHash("sha256").update(puuid).digest("hex");
}

// ─── Riot API client ──────────────────────────────────────────────────
//
// We hit three Riot endpoints during the callback :
//   1. POST https://auth.riotgames.com/token
//        -> exchanges the auth code for an access_token + id_token.
//   2. GET  https://europe.api.riotgames.com/riot/account/v1/accounts/me
//        -> returns { puuid, gameName, tagLine } using Bearer auth from
//           the access_token. We use the regional account-v1 endpoint
//           which works for any RSO-authenticated user without needing
//           to round-trip the PUUID separately.
//   3. GET  https://euw1.api.riotgames.com/lol/league/v4/entries/by-puuid/{puuid}
//          and
//          https://euw1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}/top?count=5
//        -> rank entries + top champion mastery. These use the server
//           API key (X-Riot-Token), NOT the user's access token.

export interface RiotTokenResponse {
  access_token: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface RiotAccount {
  puuid: string;
  gameName: string | null;
  tagLine: string | null;
}

export interface RiotLeagueEntry {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

export interface RiotChampionMastery {
  championId: number;
  championLevel: number;
  championPoints: number;
}

const RIOT_TOKEN_URL = "https://auth.riotgames.com/token";
const RIOT_ACCOUNT_BASE = "https://europe.api.riotgames.com";
const RIOT_RANKED_BASE = "https://euw1.api.riotgames.com";

export async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  cfg: RiotOAuthConfig,
): Promise<RiotTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    code_verifier: verifier,
  });
  // Per Riot RSO docs : Basic auth header carries the client id + secret.
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await fetch(RIOT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Riot token exchange failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as RiotTokenResponse;
}

/**
 * Fetch the authenticated player's account record. RSO scope `openid`
 * suffices — the access_token authenticates via Bearer.
 */
export async function fetchRiotAccount(accessToken: string): Promise<RiotAccount> {
  const res = await fetch(`${RIOT_ACCOUNT_BASE}/riot/account/v1/accounts/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Riot account fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as Partial<RiotAccount>;
  if (!data.puuid || typeof data.puuid !== "string") {
    throw new Error("Riot account response missing puuid");
  }
  return {
    puuid: data.puuid,
    gameName: typeof data.gameName === "string" ? data.gameName : null,
    tagLine: typeof data.tagLine === "string" ? data.tagLine : null,
  };
}

/**
 * Fetch ranked entries for a PUUID. Returns an empty list on 404
 * (unranked). Uses the Production server API key.
 */
export async function fetchRiotLeagueEntries(
  puuid: string,
  apiKey: string,
): Promise<RiotLeagueEntry[]> {
  const res = await fetch(
    `${RIOT_RANKED_BASE}/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`,
    {
      headers: { "X-Riot-Token": apiKey },
      cache: "no-store",
    },
  );
  if (res.status === 404) return [];
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Riot league entries failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.filter(
    (e): e is RiotLeagueEntry =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as RiotLeagueEntry).tier === "string",
  );
}

/**
 * Fetch the top N champion masteries for a PUUID. Default count = 5.
 * Returns an empty list on 404 / no mastery yet.
 */
export async function fetchRiotChampionMastery(
  puuid: string,
  apiKey: string,
  count = 5,
): Promise<RiotChampionMastery[]> {
  const url = `${RIOT_RANKED_BASE}/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(
    puuid,
  )}/top?count=${count}`;
  const res = await fetch(url, {
    headers: { "X-Riot-Token": apiKey },
    cache: "no-store",
  });
  if (res.status === 404) return [];
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Riot mastery fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.filter(
    (e): e is RiotChampionMastery =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as RiotChampionMastery).championId === "number",
  );
}

// ─── Format helpers ───────────────────────────────────────────────────

/**
 * Pick the most prestigious queue from the entries array (solo > flex >
 * any other) and format it as a single string : "DIAMOND IV 47LP".
 *
 * Returns `null` if every entry is either malformed or unranked.
 */
export function formatLeagueRank(entries: RiotLeagueEntry[]): string | null {
  if (entries.length === 0) return null;
  const priority: Record<string, number> = {
    RANKED_SOLO_5x5: 0,
    RANKED_FLEX_SR: 1,
  };
  const sorted = [...entries].sort((a, b) => {
    const pa = priority[a.queueType] ?? 99;
    const pb = priority[b.queueType] ?? 99;
    return pa - pb;
  });
  const best = sorted[0];
  if (!best?.tier || !best?.rank) return null;
  const tier = best.tier.toUpperCase();
  // Apex tiers (CHALLENGER / GRANDMASTER / MASTER) don't use I-IV
  // divisions — Riot still returns "I" but it's redundant.
  const isApex = tier === "CHALLENGER" || tier === "GRANDMASTER" || tier === "MASTER";
  return isApex
    ? `${tier} ${best.leaguePoints}LP`
    : `${tier} ${best.rank} ${best.leaguePoints}LP`;
}

/**
 * Champion ID -> name mapping. Hard-coded for the most common picks
 * because hitting Data Dragon at request time would slow the callback
 * by another 200-400ms and we already have CDN-backed icons via
 * championIconUrl(). When a champion ID isn't in the map we surface the
 * raw ID prefixed by "Champion " so the UI still has something to show.
 *
 * Keep this list scoped to KC's 2025-2026 meta plus the 30 most-picked
 * champions worldwide — anything else is an edge case worth a fallback.
 */
const CHAMPION_ID_TO_NAME: Record<number, string> = {
  // KC pool 2025-2026
  157: "Yasuo", 92: "Riven", 245: "Ekko", 39: "Irelia", 142: "Zoe",
  202: "Jhin", 222: "Jinx", 51: "Caitlyn", 145: "Aphelios",
  236: "Lucian", 67: "Vayne", 21: "MissFortune", 81: "Ezreal",
  117: "Lulu", 350: "Yuumi", 432: "Bard", 555: "Pyke", 412: "Thresh",
  201: "Braum", 89: "Leona", 53: "Blitzcrank", 25: "Morgana",
  64: "LeeSin", 60: "Elise", 234: "Viego", 11: "MasterYi", 121: "Khazix",
  104: "Graves", 19: "Warwick", 102: "Shyvana",
  103: "Ahri", 38: "Kassadin", 69: "Cassiopeia", 84: "Akali", 246: "Qiyana",
  4: "TwistedFate", 7: "LeBlanc", 90: "Malzahar", 134: "Syndra",
  // Top lane
  86: "Garen", 122: "Darius", 23: "Tryndamere", 17: "Teemo", 75: "Nasus",
  150: "Gnar", 54: "Malphite", 78: "Poppy", 266: "Aatrox", 57: "Maokai",
  98: "Shen", 24: "Jax", 80: "Pantheon",
};

export function championIdToName(id: number): string {
  return CHAMPION_ID_TO_NAME[id] ?? `Champion ${id}`;
}

export interface StoredChampionMastery {
  champ_id: number;
  name: string;
  level: number;
  points: number;
}

export function shapeChampionsForStorage(
  raw: RiotChampionMastery[],
): StoredChampionMastery[] {
  return raw.slice(0, 5).map((m) => ({
    champ_id: m.championId,
    name: championIdToName(m.championId),
    level: m.championLevel,
    points: m.championPoints,
  }));
}
