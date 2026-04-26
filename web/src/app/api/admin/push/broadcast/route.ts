/**
 * POST /api/admin/push/broadcast
 *
 * Editorial broadcast endpoint. Two modes :
 *
 *   { mode: "enqueue" | undefined } — INSERT into push_notifications
 *      and return immediately. The Python worker daemon sends within
 *      ~5 minutes. Use this for any broadcast > ~200 subscribers.
 *
 *   { mode: "send_now" } — Same enqueue, then send synchronously
 *      using the Node web-push library. Bounded by Vercel's 60s
 *      function timeout. Use for one-off urgent broadcasts.
 *
 * Body :
 *   {
 *     mode?: "enqueue" | "send_now",
 *     kind: "kill" | "kill_of_the_week" | "editorial_pin" | "live_match"
 *           | "broadcast" | "system",
 *     title: string,
 *     body: string,
 *     url?: string,
 *     icon_url?: string,
 *     image_url?: string,
 *     kill_id?: string,
 *     dedupe_key?: string,
 *   }
 *
 * If kill_id is set without title/body, we auto-fill them from the
 * kill row so the editor only has to pick a clip and click "Push".
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { deriveActorRole, logAdminAction, requireAdmin } from "@/lib/admin/audit";
import { enqueuePush, sendNow, type PushKind } from "@/lib/push/send";

interface BroadcastBody {
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

const VALID_KINDS: ReadonlySet<PushKind> = new Set([
  "kill",
  "kill_of_the_week",
  "editorial_pin",
  "live_match",
  "broadcast",
  "system",
]);

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: 403 });
  }

  let body: BroadcastBody;
  try {
    body = (await request.json()) as BroadcastBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = body.kind;
  if (!kind || !VALID_KINDS.has(kind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${[...VALID_KINDS].join(", ")}` },
      { status: 400 },
    );
  }

  let title = (body.title ?? "").trim();
  let bodyText = (body.body ?? "").trim();
  let url = body.url?.trim() || "/scroll";
  let iconUrl = body.icon_url?.trim() || undefined;
  let imageUrl = body.image_url?.trim() || undefined;

  // Auto-fill from kill if title/body not provided.
  if (body.kill_id && (!title || !bodyText)) {
    const sb = await createServerSupabase();
    const { data: kill } = await sb
      .from("kills")
      .select("killer_champion,victim_champion,ai_description,thumbnail_url,multi_kill")
      .eq("id", body.kill_id)
      .maybeSingle();
    if (kill) {
      const killerChamp = kill.killer_champion ?? "?";
      const victimChamp = kill.victim_champion ?? "?";
      const multi = kill.multi_kill ? `[${kill.multi_kill.toUpperCase()}] ` : "";
      title = title || `${multi}${killerChamp} → ${victimChamp}`;
      bodyText = bodyText || (kill.ai_description ?? "Nouveau clip Karmine Corp 🔥");
      url = url === "/scroll" ? `/scroll?kill=${body.kill_id}` : url;
      imageUrl = imageUrl || kill.thumbnail_url || undefined;
    }
  }

  if (!title || !bodyText) {
    return NextResponse.json(
      { error: "title and body required (or pass kill_id to auto-fill)" },
      { status: 400 },
    );
  }

  const params = {
    kind,
    title,
    body: bodyText,
    url,
    iconUrl,
    imageUrl,
    killId: body.kill_id,
    dedupeKey: body.dedupe_key,
    sentBy: "admin",
  };

  if (body.mode === "send_now") {
    const result = await sendNow(params);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Send failed" }, { status: 500 });
    }
    await logAdminAction({
      action: "push.broadcast.send_now",
      entityType: "push_notification",
      entityId: body.kill_id,
      after: { kind, title, url, kill_id: body.kill_id, dedupe_key: body.dedupe_key },
      actorRole: deriveActorRole(admin),
      request,
    });
    return NextResponse.json(result);
  }

  const result = await enqueuePush(params);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Enqueue failed" }, { status: 500 });
  }
  await logAdminAction({
    action: "push.broadcast.enqueue",
    entityType: "push_notification",
    entityId: body.kill_id,
    after: { kind, title, url, kill_id: body.kill_id, dedupe_key: body.dedupe_key },
    actorRole: deriveActorRole(admin),
    request,
  });
  return NextResponse.json(result);
}
