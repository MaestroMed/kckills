import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Log an admin action to the audit trail.
 * Silent-fail — never block the primary action if logging fails.
 */
export async function logAdminAction(params: {
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  notes?: string;
  actorLabel?: string;
}): Promise<void> {
  try {
    const sb = await createServerSupabase();
    await sb.from("admin_actions").insert({
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      before: params.before ?? null,
      after: params.after ?? null,
      notes: params.notes ?? null,
      actor_label: params.actorLabel ?? "mehdi",
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
 */
export async function requireAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
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
    return { ok: true };
  }

  // Path 1: cookie token match
  if (expectedToken) {
    try {
      const { cookies } = await import("next/headers");
      const c = await cookies();
      if (c.get("kc_admin")?.value === expectedToken) return { ok: true };
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
      if (discordId && allowedDiscordIds.includes(discordId)) return { ok: true };
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
      if (email && allowedEmails.includes(email)) return { ok: true };
    } catch {
      /* fall through */
    }
  }

  return { ok: false, error: "Forbidden — admin access required" };
}
