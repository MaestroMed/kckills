/**
 * /api/admin/push/broadcast
 *
 * Wave 18 — admin form migrated to Server Actions
 * (see web/src/app/admin/push/actions.ts). Kept as a thin proxy for
 * external callers (Discord bot, scheduled tasks, KOTW worker).
 */

import { NextRequest, NextResponse } from "next/server";
import { broadcastPush, type BroadcastInput } from "@/app/admin/push/actions";

export async function POST(request: NextRequest) {
  let body: BroadcastInput;
  try {
    body = (await request.json()) as BroadcastInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const result = await broadcastPush(body);
  if (!result.ok) {
    const status = result.error?.includes("Forbidden") ? 403 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result);
}
