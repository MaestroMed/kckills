"use server";

/**
 * Server Action for /admin/push (Wave 18 — migrate fetch POST → Server
 * Action). Replaces the fetch onto /api/admin/push/broadcast that
 * either enqueues a push notification or sends it synchronously.
 *
 * The legacy /api/admin/push/broadcast route is KEPT as a thin proxy.
 *
 * Note : send_now mode iterates over every subscriber via web-push. The
 * 60s Vercel function timeout still applies — server actions don't
 * relax it. The UI gates send_now behind a confirm dialog when there
 * are >200 subscribers.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  deriveActorRole,
  logAdminAction,
  requireAdmin,
} from "@/lib/admin/audit";
import { enqueuePush, sendNow, type PushKind } from "@/lib/push/send";

const VALID_KINDS: ReadonlySet<PushKind> = new Set([
  "kill",
  "kill_of_the_week",
  "editorial_pin",
  "live_match",
  "broadcast",
  "system",
]);

export interface BroadcastInput {
  mode?: "enqueue" | "send_now";
  kind?: PushKind;
  title?: string;
  body?: string;
  url?: string;
  icon_url?: string;
  image_url?: string;
  kill_id?: string;
  dedupe_key?: string;
}

export interface BroadcastResult {
  ok: boolean;
  sent?: number;
  failed?: number;
  expired?: number;
  deduped?: boolean;
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
  return new Request("https://kckills.com/admin/push", { headers: init });
}

export async function broadcastPush(input: BroadcastInput): Promise<BroadcastResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };

  const kind = input.kind;
  if (!kind || !VALID_KINDS.has(kind)) {
    return { ok: false, error: `kind must be one of: ${[...VALID_KINDS].join(", ")}` };
  }

  let title = (input.title ?? "").trim();
  let bodyText = (input.body ?? "").trim();
  let url = input.url?.trim() || "/scroll";
  let iconUrl = input.icon_url?.trim() || undefined;
  let imageUrl = input.image_url?.trim() || undefined;

  // Auto-fill from kill if title/body not provided.
  if (input.kill_id && (!title || !bodyText)) {
    const sb = await createServerSupabase();
    const { data: killRow } = await sb
      .from("kills")
      .select("killer_champion,victim_champion,ai_description,thumbnail_url,multi_kill")
      .eq("id", input.kill_id)
      .maybeSingle();
    const kill = killRow as {
      killer_champion: string | null;
      victim_champion: string | null;
      ai_description: string | null;
      thumbnail_url: string | null;
      multi_kill: string | null;
    } | null;
    if (kill) {
      const killerChamp = kill.killer_champion ?? "?";
      const victimChamp = kill.victim_champion ?? "?";
      const multi = kill.multi_kill ? `[${kill.multi_kill.toUpperCase()}] ` : "";
      title = title || `${multi}${killerChamp} → ${victimChamp}`;
      bodyText = bodyText || (kill.ai_description ?? "Nouveau clip Karmine Corp 🔥");
      url = url === "/scroll" ? `/scroll?kill=${input.kill_id}` : url;
      imageUrl = imageUrl || kill.thumbnail_url || undefined;
    }
  }

  if (!title || !bodyText) {
    return {
      ok: false,
      error: "title and body required (or pass kill_id to auto-fill)",
    };
  }

  const params = {
    kind,
    title,
    body: bodyText,
    url,
    iconUrl,
    imageUrl,
    killId: input.kill_id,
    dedupeKey: input.dedupe_key,
    sentBy: "admin",
  };

  const auditReq = await buildAuditRequest();

  if (input.mode === "send_now") {
    const result = await sendNow(params);
    if (!result.ok) {
      return { ok: false, error: result.error ?? "Send failed" };
    }
    await logAdminAction({
      action: "push.broadcast.send_now",
      entityType: "push_notification",
      entityId: input.kill_id,
      after: {
        kind,
        title,
        url,
        kill_id: input.kill_id,
        dedupe_key: input.dedupe_key,
      },
      actorRole: deriveActorRole(admin),
      request: auditReq,
    });
    revalidatePath("/admin/push");
    return {
      ok: true,
      sent: (result as { sent?: number }).sent,
      failed: (result as { failed?: number }).failed,
      expired: (result as { expired?: number }).expired,
      deduped: (result as { deduped?: boolean }).deduped,
    };
  }

  const result = await enqueuePush(params);
  if (!result.ok) {
    return { ok: false, error: result.error ?? "Enqueue failed" };
  }
  await logAdminAction({
    action: "push.broadcast.enqueue",
    entityType: "push_notification",
    entityId: input.kill_id,
    after: { kind, title, url, kill_id: input.kill_id, dedupe_key: input.dedupe_key },
    actorRole: deriveActorRole(admin),
    request: auditReq,
  });

  revalidatePath("/admin/push");
  return {
    ok: true,
    deduped: (result as { deduped?: boolean }).deduped,
  };
}
