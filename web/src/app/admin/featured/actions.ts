"use server";

/**
 * Server Actions for /admin/featured (Wave 18 — migrate fetch POST →
 * Server Actions). Replaces the client-side `fetch("/api/admin/featured/
 * [date]")` calls with direct RPC, removing the HTTP round-trip and the
 * fetch-wrapper boilerplate from the client bundle.
 *
 * Auth gate : reuses `requireAdmin()` (cookie-token / Discord OAuth /
 * email allowlist) — same logic as the API route. Failures throw an
 * Error so the form layer can surface them via useActionState.
 *
 * Cache invalidation : `revalidatePath("/admin/featured")` after every
 * mutation so the calendar reflects the new state on the next render.
 *
 * The legacy /api/admin/featured/[date] route is KEPT as a thin proxy
 * for any external integration that might still call it.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  deriveActorRole,
  logAdminAction,
  requireAdmin,
} from "@/lib/admin/audit";

export interface FeaturedActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Build a synthetic Request from incoming headers so logAdminAction()
 * can derive ip_hash + user_agent_class. Server actions don't have the
 * NextRequest object, but headers() works the same.
 */
async function buildAuditRequest(): Promise<Request> {
  const h = await headers();
  const init: HeadersInit = {};
  const xff = h.get("x-forwarded-for");
  const xRealIp = h.get("x-real-ip");
  const ua = h.get("user-agent");
  if (xff) init["x-forwarded-for"] = xff;
  if (xRealIp) init["x-real-ip"] = xRealIp;
  if (ua) init["user-agent"] = ua;
  return new Request("https://kckills.com/admin/featured", { headers: init });
}

/** Set the featured kill for a given date (YYYY-MM-DD). */
export async function setFeaturedKill(
  date: string,
  killId: string,
  notes: string | null = null,
): Promise<FeaturedActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Invalid date format (YYYY-MM-DD)" };
  }
  if (!killId) {
    return { ok: false, error: "kill_id required" };
  }

  const sb = await createServerSupabase();

  const { data: before } = await sb
    .from("featured_clips")
    .select("kill_id,notes,set_by_actor,set_at")
    .eq("feature_date", date)
    .maybeSingle();

  const { error } = await sb.from("featured_clips").upsert(
    {
      feature_date: date,
      kill_id: killId,
      notes,
      set_by_actor: "admin",
      set_at: new Date().toISOString(),
    },
    { onConflict: "feature_date" },
  );

  if (error) return { ok: false, error: error.message };

  const auditReq = await buildAuditRequest();
  await logAdminAction({
    action: "featured.set",
    entityType: "featured",
    entityId: date,
    before,
    after: { kill_id: killId, notes },
    actorRole: deriveActorRole(admin),
    request: auditReq,
  });

  // Discord notif for today's pin (mirrors the legacy route exactly).
  const today = new Date().toISOString().slice(0, 10);
  if (date === today) {
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (webhook) {
      const { data: kill } = await sb
        .from("kills")
        .select("killer_champion,victim_champion,ai_description,thumbnail_url,highlight_score")
        .eq("id", killId)
        .maybeSingle();
      if (kill) {
        try {
          await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              embeds: [
                {
                  title: `★ Clip vedette du jour : ${kill.killer_champion} → ${kill.victim_champion}`,
                  description: kill.ai_description ?? "",
                  url: `https://kckills.com/scroll?kill=${killId}`,
                  color: 0xffd700,
                  thumbnail: kill.thumbnail_url ? { url: kill.thumbnail_url } : undefined,
                  footer: {
                    text: `Score ${kill.highlight_score?.toFixed(1) ?? "?"}/10 · KCKILLS`,
                  },
                  timestamp: new Date().toISOString(),
                },
              ],
            }),
          });
        } catch {
          /* discord failure is non-blocking */
        }
      }
    }
  }

  revalidatePath("/admin/featured");
  revalidatePath("/");
  return { ok: true };
}

/** Remove the featured pin for a given date. */
export async function removeFeaturedKill(date: string): Promise<FeaturedActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Invalid date format (YYYY-MM-DD)" };
  }

  const sb = await createServerSupabase();

  const { data: before } = await sb
    .from("featured_clips")
    .select("kill_id,notes,set_by_actor,set_at")
    .eq("feature_date", date)
    .maybeSingle();

  const { error } = await sb.from("featured_clips").delete().eq("feature_date", date);
  if (error) return { ok: false, error: error.message };

  const auditReq = await buildAuditRequest();
  await logAdminAction({
    action: "featured.delete",
    entityType: "featured",
    entityId: date,
    before,
    actorRole: deriveActorRole(admin),
    request: auditReq,
  });

  revalidatePath("/admin/featured");
  revalidatePath("/");
  return { ok: true };
}
