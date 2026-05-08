"use server";

/**
 * Server Actions for /admin/roster (Wave 18 — migrate fetch PATCH →
 * Server Action). Replaces the per-row `fetch("/api/admin/players/
 * [id]")` PATCH used by the inline IGN / role / nationality / image_url
 * editors.
 *
 * The legacy /api/admin/players/[id] PATCH route is KEPT as a thin
 * proxy because the worker / scripts may PATCH players directly.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  deriveActorRole,
  logAdminAction,
  requireAdmin,
} from "@/lib/admin/audit";

const VALID_ROLES = ["top", "jungle", "mid", "bottom", "support"];

export interface PlayerPatchInput {
  ign?: string;
  real_name?: string | null;
  nationality?: string | null;
  image_url?: string | null;
  team_id?: string | null;
  role?: string | null;
  display_order?: number;
}

export interface PlayerPatchResult {
  ok: boolean;
  error?: string;
}

async function buildAuditRequest(playerId: string): Promise<Request> {
  const h = await headers();
  const init: HeadersInit = {};
  const xff = h.get("x-forwarded-for");
  const xRealIp = h.get("x-real-ip");
  const ua = h.get("user-agent");
  if (xff) init["x-forwarded-for"] = xff;
  if (xRealIp) init["x-real-ip"] = xRealIp;
  if (ua) init["user-agent"] = ua;
  return new Request(`https://kckills.com/admin/roster/${playerId}`, { headers: init });
}

export async function patchPlayer(
  id: string,
  body: PlayerPatchInput,
): Promise<PlayerPatchResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };
  if (!id) return { ok: false, error: "id required" };

  const patch: Record<string, unknown> = {};
  if (typeof body.ign === "string" && body.ign.trim().length > 0) {
    patch.ign = body.ign.trim();
  }
  if (typeof body.real_name === "string" || body.real_name === null) {
    patch.real_name = body.real_name;
  }
  if (typeof body.nationality === "string" || body.nationality === null) {
    patch.nationality = body.nationality;
  }
  if (typeof body.image_url === "string" || body.image_url === null) {
    patch.image_url = body.image_url;
  }
  if (typeof body.team_id === "string" || body.team_id === null) {
    patch.team_id = body.team_id;
  }
  if (typeof body.role === "string" && VALID_ROLES.includes(body.role)) {
    patch.role = body.role;
  } else if (body.role === null) {
    patch.role = null;
  }
  if (
    typeof body.display_order === "number"
    && Number.isFinite(body.display_order)
    && body.display_order >= 0
    && body.display_order <= 99
  ) {
    patch.display_order = Math.floor(body.display_order);
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Nothing to update" };
  }

  const sb = await createServerSupabase();
  const { data: before } = await sb.from("players").select("*").eq("id", id).maybeSingle();
  const { error } = await sb.from("players").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };

  const auditReq = await buildAuditRequest(id);
  await logAdminAction({
    action: "player.edit",
    entityType: "player",
    entityId: id,
    before: before
      ? Object.fromEntries(
          Object.keys(patch).map((k) => [k, (before as Record<string, unknown>)[k]]),
        )
      : null,
    after: patch,
    actorRole: deriveActorRole(admin),
    request: auditReq,
  });

  revalidatePath("/admin/roster");
  revalidatePath(`/player/${(before as { ign?: string } | null)?.ign?.toLowerCase() ?? ""}`);
  return { ok: true };
}
