"use server";

/**
 * Server Actions for /admin/editorial (Wave 18 — migrate fetch POST →
 * Server Actions). Covers the two fast-path mutations on the editorial
 * board :
 *   - pinFeature() : range-based pin to homepage hero
 *   - toggleKillHide() : flip kill_visible on/off
 *
 * NOT migrated : pushDiscord (it fires an external HTTP call mid-handler
 * — kept on the API route for consistency with the task spec). The
 * legacy /api/admin/editorial/feature and /api/admin/editorial/hide
 * routes are KEPT as thin proxies for external integrations.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  deriveActorRole,
  logAdminAction,
  requireAdmin,
} from "@/lib/admin/audit";

export interface FeaturePinInput {
  kill_id: string;
  valid_from: string;
  valid_to: string;
  custom_note?: string | null;
}

export interface FeaturePinResult {
  ok: boolean;
  feature_date?: string;
  error?: string;
}

export interface HideInput {
  kill_id: string;
  hide: boolean;
}

export interface HideResult {
  ok: boolean;
  kill_visible?: boolean;
  error?: string;
}

async function buildAuditRequest(): Promise<Request> {
  const h = await headers();
  const init: HeadersInit = {};
  const xff = h.get("x-forwarded-for");
  const xRealIp = h.get("x-real-ip");
  const ua = h.get("user-agent");
  if (xff) init["x-forwarded-for"] = xff;
  if (xRealIp) init["x-real-ip"] = xRealIp;
  if (ua) init["user-agent"] = ua;
  return new Request("https://kckills.com/admin/editorial", { headers: init });
}

/** Pin a kill to the homepage hero for an arbitrary time window. */
export async function pinFeature(input: FeaturePinInput): Promise<FeaturePinResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };

  const { kill_id, valid_from, valid_to } = input;
  const custom_note =
    typeof input.custom_note === "string" && input.custom_note.trim()
      ? input.custom_note.slice(0, 200)
      : null;

  if (!kill_id || !valid_from || !valid_to) {
    return { ok: false, error: "kill_id, valid_from, valid_to are required" };
  }

  const fromMs = Date.parse(valid_from);
  const toMs = Date.parse(valid_to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return { ok: false, error: "Invalid timestamp(s)" };
  }
  if (toMs <= fromMs) {
    return { ok: false, error: "valid_to must be after valid_from" };
  }
  if (toMs - fromMs > 30 * 24 * 3600 * 1000) {
    return {
      ok: false,
      error: "Window too long (max 30 days — use a longer-lived editorial decision)",
    };
  }

  const sb = await createServerSupabase();

  const { data: kill, error: killErr } = await sb
    .from("kills")
    .select("id,status,kill_visible")
    .eq("id", kill_id)
    .maybeSingle();
  if (killErr) return { ok: false, error: killErr.message };
  if (!kill) return { ok: false, error: "Kill not found" };
  if ((kill as { status?: string }).status !== "published") {
    return {
      ok: false,
      error: `Cannot pin kill in status="${(kill as { status?: string }).status}"`,
    };
  }

  const featureDate = new Date(fromMs).toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const { error: upErr } = await sb.from("featured_clips").upsert(
    {
      feature_date: featureDate,
      kill_id,
      valid_from,
      valid_to,
      custom_note,
      set_by: "admin",
      set_by_actor: "admin",
      set_at: nowIso,
    },
    { onConflict: "feature_date" },
  );
  if (upErr) return { ok: false, error: upErr.message };

  await sb.from("editorial_actions").insert({
    action: "feature.pin",
    kill_id,
    performed_by: "admin",
    payload: { valid_from, valid_to, custom_note, feature_date: featureDate },
  });

  const auditReq = await buildAuditRequest();
  await logAdminAction({
    action: "feature.pin",
    entityType: "kill",
    entityId: kill_id,
    after: { valid_from, valid_to, custom_note, feature_date: featureDate },
    actorRole: deriveActorRole(admin),
    request: auditReq,
  });

  revalidatePath("/admin/editorial");
  revalidatePath("/admin/featured");
  revalidatePath("/");
  return { ok: true, feature_date: featureDate };
}

/** Toggle kill_visible on a single kill. */
export async function toggleKillHide(input: HideInput): Promise<HideResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };

  const { kill_id, hide } = input;
  if (!kill_id || typeof hide !== "boolean") {
    return { ok: false, error: "kill_id and hide (boolean) required" };
  }

  const sb = await createServerSupabase();

  const { data: before, error: beforeErr } = await sb
    .from("kills")
    .select("id,kill_visible")
    .eq("id", kill_id)
    .maybeSingle();
  if (beforeErr) return { ok: false, error: beforeErr.message };
  if (!before) return { ok: false, error: "Kill not found" };

  const nextVisible = !hide;
  const { error: upErr } = await sb
    .from("kills")
    .update({ kill_visible: nextVisible, updated_at: new Date().toISOString() })
    .eq("id", kill_id);
  if (upErr) return { ok: false, error: upErr.message };

  await sb.from("editorial_actions").insert({
    action: hide ? "kill.hide" : "kill.unhide",
    kill_id,
    performed_by: "admin",
    payload: {
      previous_kill_visible: (before as { kill_visible?: boolean | null }).kill_visible,
      new_kill_visible: nextVisible,
    },
  });

  const auditReq = await buildAuditRequest();
  await logAdminAction({
    action: hide ? "kill.hide" : "kill.unhide",
    entityType: "kill",
    entityId: kill_id,
    before: { kill_visible: (before as { kill_visible?: boolean | null }).kill_visible },
    after: { kill_visible: nextVisible },
    actorRole: deriveActorRole(admin),
    request: auditReq,
  });

  revalidatePath("/admin/editorial");
  revalidatePath(`/admin/clips/${kill_id}`);
  revalidatePath("/scroll");
  return { ok: true, kill_visible: nextVisible };
}
