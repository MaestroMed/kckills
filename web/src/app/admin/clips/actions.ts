"use server";

/**
 * Server Actions for /admin/clips/[id] (Wave 18 — migrate fetch PATCH →
 * Server Actions). Replaces the client-side `fetch("/api/admin/clips/
 * [id]")` PATCH call that the clip detail editor uses to save AI
 * description / fight type / tags / score / hidden / needs_reclip.
 *
 * Auth gate : reuses `requireAdmin()`. Validation logic mirrors the
 * legacy route.ts exactly so the audit diff and tag whitelist stay
 * consistent across surfaces.
 *
 * The legacy /api/admin/clips/[id] PATCH route is KEPT as a thin proxy
 * so any external integration (scripts, Postman) keeps working. New
 * code should import the action directly.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  deriveActorRole,
  logAdminAction,
  requireAdmin,
} from "@/lib/admin/audit";

const VALID_FIGHT_TYPES = [
  "solo_kill",
  "pick",
  "gank",
  "skirmish_2v2",
  "skirmish_3v3",
  "teamfight_4v4",
  "teamfight_5v5",
];

const VALID_TAGS = [
  "outplay",
  "teamfight",
  "solo_kill",
  "tower_dive",
  "baron_fight",
  "dragon_fight",
  "flash_predict",
  "1v2",
  "1v3",
  "clutch",
  "clean",
  "mechanical",
  "shutdown",
  "comeback",
  "engage",
  "peel",
  "snipe",
  "steal",
  "skirmish",
  "pick",
  "gank",
  "ace",
  "flank",
];

export interface ClipPatchInput {
  ai_description?: string;
  fight_type?: string;
  ai_tags?: string[];
  highlight_score?: number;
  hidden?: boolean;
  kill_visible?: boolean;
  needs_reclip?: boolean;
  reclip_reason?: string | null;
}

export interface ClipPatchResult {
  ok: boolean;
  patched?: string[];
  error?: string;
}

async function buildAuditRequest(killId: string): Promise<Request> {
  const h = await headers();
  const init: HeadersInit = {};
  const xff = h.get("x-forwarded-for");
  const xRealIp = h.get("x-real-ip");
  const ua = h.get("user-agent");
  if (xff) init["x-forwarded-for"] = xff;
  if (xRealIp) init["x-real-ip"] = xRealIp;
  if (ua) init["user-agent"] = ua;
  return new Request(`https://kckills.com/admin/clips/${killId}`, { headers: init });
}

/** PATCH a single kill row (admin clip-detail editor). */
export async function patchClip(
  id: string,
  body: ClipPatchInput,
): Promise<ClipPatchResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };
  if (!id) return { ok: false, error: "id required" };

  const sb = await createServerSupabase();

  const { data: before } = await sb
    .from("kills")
    .select(
      "ai_description, fight_type, ai_tags, highlight_score, kill_visible, needs_reclip, reclip_reason",
    )
    .eq("id", id)
    .single();

  const patch: Record<string, unknown> = {};
  if (typeof body.ai_description === "string" && body.ai_description.trim()) {
    patch.ai_description = body.ai_description.trim();
  }
  if (typeof body.fight_type === "string" && VALID_FIGHT_TYPES.includes(body.fight_type)) {
    patch.fight_type = body.fight_type;
  }
  if (Array.isArray(body.ai_tags)) {
    patch.ai_tags = body.ai_tags.filter((t) => VALID_TAGS.includes(t));
  }
  if (
    typeof body.highlight_score === "number"
    && body.highlight_score >= 1
    && body.highlight_score <= 10
  ) {
    patch.highlight_score = Math.round(body.highlight_score * 10) / 10;
  }
  if (typeof body.hidden === "boolean") {
    patch.kill_visible = !body.hidden;
  } else if (typeof body.kill_visible === "boolean") {
    patch.kill_visible = body.kill_visible;
  }
  if (typeof body.needs_reclip === "boolean") {
    patch.needs_reclip = body.needs_reclip;
    if (body.needs_reclip && typeof body.reclip_reason === "string") {
      patch.reclip_reason = body.reclip_reason;
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No valid fields to update" };
  }

  patch.updated_at = new Date().toISOString();

  const { error } = await sb.from("kills").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };

  const auditReq = await buildAuditRequest(id);
  await logAdminAction({
    action: "kill.edit",
    entityType: "kill",
    entityId: id,
    before,
    after: patch,
    actorRole: deriveActorRole(admin),
    request: auditReq,
  });

  revalidatePath(`/admin/clips/${id}`);
  revalidatePath("/admin/clips");
  revalidatePath(`/kill/${id}`);
  return { ok: true, patched: Object.keys(patch) };
}
