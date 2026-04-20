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
export async function requireAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  // TODO: check Discord OAuth session + admin role
  return { ok: true };
}
