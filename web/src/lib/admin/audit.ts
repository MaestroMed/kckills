import "server-only";
import { createHash, randomUUID } from "crypto";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Result of `requireAdmin()` augmented with the auth path that succeeded.
 * Used by `deriveActorRole()` so logAdminAction can record HOW the actor
 * authenticated (cookie token vs Discord OAuth vs Supabase email).
 */
export type AdminCheckResult =
  | { ok: true; role?: AdminActorRole }
  | { ok: false; error: string };

export type AdminActorRole = "token" | "discord" | "email" | "unknown";

/** Coarse classification of a User-Agent string for audit telemetry. */
export type UserAgentClass = "mobile" | "desktop" | "bot" | "unknown";

/**
 * Derive a coarse role label from a `requireAdmin()` result. Falls back
 * to "unknown" when the helper returned an `ok` without an explicit role
 * (older code paths) or when the check failed.
 */
export function deriveActorRole(result: AdminCheckResult): AdminActorRole {
  if (!result.ok) return "unknown";
  return result.role ?? "unknown";
}

/**
 * Hash an IP address for audit storage.
 * SHA-256 is reversible only via brute force over the 32-bit IPv4 space —
 * acceptable for our ZK posture since IPs aren't a unique identifier on
 * shared NATs / mobile carriers anyway. The hash lets us correlate
 * actions from the same source without storing the raw IP.
 */
function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

/**
 * Best-effort UA parsing without pulling in a 100KB UA database.
 * We only need 4 buckets for "is this person a bot or a phone or a laptop"
 * — actual UA strings aren't useful in audit context, classification is.
 */
function classifyUserAgent(ua: string | null): UserAgentClass {
  if (!ua) return "unknown";
  const lower = ua.toLowerCase();
  if (
    lower.includes("bot")
    || lower.includes("crawler")
    || lower.includes("spider")
    || lower.includes("curl")
    || lower.includes("wget")
    || lower.includes("python-requests")
    || lower.includes("axios/")
  ) {
    return "bot";
  }
  if (
    lower.includes("mobile")
    || lower.includes("android")
    || lower.includes("iphone")
    || lower.includes("ipad")
  ) {
    return "mobile";
  }
  if (
    lower.includes("mozilla")
    || lower.includes("chrome")
    || lower.includes("safari")
    || lower.includes("firefox")
    || lower.includes("edge")
  ) {
    return "desktop";
  }
  return "unknown";
}

/**
 * Read the client IP from typical proxy headers.
 * Vercel sets `x-forwarded-for` (comma-separated chain — first hop is
 * the client) ; we also accept `x-real-ip` as a fallback for self-hosted
 * deployments behind nginx.
 */
function readClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xRealIp = req.headers.get("x-real-ip");
  if (xRealIp) return xRealIp.trim();
  return null;
}

/**
 * Log an admin action to the audit trail.
 * Silent-fail — never block the primary action if logging fails.
 *
 * When `request` is provided, we derive ip_hash and user_agent_class
 * from its headers. Both stay `null` when the request is omitted (e.g.
 * background-job audit calls with no HTTP context).
 *
 * When `actorRole` isn't explicitly passed, it defaults to "unknown" —
 * callers should derive it via `deriveActorRole(adminCheckResult)` and
 * pass it explicitly so the log shows WHICH auth path succeeded.
 */
export async function logAdminAction(params: {
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  notes?: string;
  actorLabel?: string;
  actorRole?: AdminActorRole;
  request?: Request;
}): Promise<void> {
  try {
    const sb = await createServerSupabase();

    let ipHash: string | null = null;
    let userAgentClass: UserAgentClass | null = null;

    if (params.request) {
      const ip = readClientIp(params.request);
      ipHash = ip ? hashIp(ip) : null;
      userAgentClass = classifyUserAgent(params.request.headers.get("user-agent"));
    }

    const requestId = randomUUID().replace(/-/g, "").slice(0, 12);

    await sb.from("admin_actions").insert({
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      before: params.before ?? null,
      after: params.after ?? null,
      notes: params.notes ?? null,
      actor_label: params.actorLabel ?? "mehdi",
      actor_role: params.actorRole ?? "unknown",
      ip_hash: ipHash,
      request_id: requestId,
      user_agent_class: userAgentClass,
    });
  } catch {
    // Silent-fail: audit is best-effort, never blocks the primary action.
  }
}

/**
 * Stub admin auth. For now /admin/* is not indexed and not linked anywhere public.
 * When Discord OAuth admin roles land, this is the single seam to update.
 */
/**
 * Admin gate. Two acceptance paths:
 *   1. Cookie `kc_admin` matches `KCKILLS_ADMIN_TOKEN` env var
 *   2. Discord OAuth user is in the `KCKILLS_ADMIN_DISCORD_IDS` allowlist
 *
 * Fail-closed in production : if NEITHER env var is configured in a
 * production deployment, the gate REFUSES every request. This prevents
 * a typo / unset env / preview-deployment slip from silently exposing
 * the backoffice. In NODE_ENV=development the historical "no env =
 * open" behaviour is preserved so local `pnpm dev` works.
 *
 * Returns `{ ok: true, role }` on success — `role` indicates WHICH path
 * matched ("token" / "discord" / "email") so audit can record it.
 */
export async function requireAdmin(): Promise<AdminCheckResult> {
  const expectedToken = process.env.KCKILLS_ADMIN_TOKEN;
  const allowedDiscordIds = (process.env.KCKILLS_ADMIN_DISCORD_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const allowedEmailsEarly = (process.env.KCKILLS_ADMIN_EMAILS ?? "").trim();
  const isProduction = process.env.NODE_ENV === "production";

  // PR-SECURITY-A : production fail-closed.
  // PR-SECURITY-B : also accept email allowlist as a valid auth path.
  if (
    isProduction
    && !expectedToken
    && allowedDiscordIds.length === 0
    && !allowedEmailsEarly
  ) {
    return {
      ok: false,
      error: "Admin auth not configured (server misconfigured — refusing access)",
    };
  }

  // Dev mode — no env vars set, allow all (preserves local dev UX).
  if (!expectedToken && allowedDiscordIds.length === 0 && !allowedEmailsEarly) {
    return { ok: true, role: "unknown" };
  }

  // Path 1: cookie token match
  if (expectedToken) {
    try {
      const { cookies } = await import("next/headers");
      const c = await cookies();
      if (c.get("kc_admin")?.value === expectedToken) return { ok: true, role: "token" };
    } catch {
      /* cookies() can throw outside RSC */
    }
  }

  // Path 2: Discord OAuth allowlist
  if (allowedDiscordIds.length > 0) {
    try {
      const sb = await createServerSupabase();
      const { data: { user } } = await sb.auth.getUser();
      const discordId = (user?.user_metadata as { provider_id?: string } | undefined)?.provider_id;
      if (discordId && allowedDiscordIds.includes(discordId)) return { ok: true, role: "discord" };
    } catch {
      /* fall through */
    }
  }

  // Path 3: Supabase Auth email allowlist (PR-SECURITY-B)
  // Lets you give access to multiple admins by adding their emails to
  // KCKILLS_ADMIN_EMAILS (comma-separated). They sign up via Supabase
  // Auth (email + password) at /admin/login — once their email is on
  // the allowlist, requireAdmin() lets them through. Safe because :
  //   - Supabase manages bcrypt hashing + sessions
  //   - Email allowlist is server-side env var, can't be tampered
  //   - Each admin has their own credentials → audit trail per person
  const allowedEmails = (process.env.KCKILLS_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowedEmails.length > 0) {
    try {
      const sb = await createServerSupabase();
      const { data: { user } } = await sb.auth.getUser();
      const email = user?.email?.toLowerCase();
      if (email && allowedEmails.includes(email)) return { ok: true, role: "email" };
    } catch {
      /* fall through */
    }
  }

  return { ok: false, error: "Forbidden — admin access required" };
}
