/**
 * /api/admin/featured/[date]
 *
 * Wave 18 — admin form migrated to Server Actions
 * (see web/src/app/admin/featured/actions.ts). This route is kept as a
 * thin proxy so any external caller (Discord bot, scripts, browser
 * extension) that still POSTs here continues to work.
 *
 * It just calls the same server action under the hood. New code should
 * import the action directly.
 */

import { NextRequest, NextResponse } from "next/server";
import { setFeaturedKill, removeFeaturedKill } from "@/app/admin/featured/actions";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  let body: { kill_id?: string; notes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const killId = body.kill_id;
  const notes = typeof body.notes === "string" ? body.notes : null;
  if (!killId) {
    return NextResponse.json({ error: "kill_id required" }, { status: 400 });
  }
  const result = await setFeaturedKill(date, killId, notes);
  if (!result.ok) {
    const status = result.error?.includes("Forbidden") ? 403 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  const result = await removeFeaturedKill(date);
  if (!result.ok) {
    const status = result.error?.includes("Forbidden") ? 403 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
