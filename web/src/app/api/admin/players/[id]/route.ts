/**
 * /api/admin/players/[id]
 *
 * Wave 18 — admin form migrated to Server Actions
 * (see web/src/app/admin/roster/actions.ts). This route is kept as a
 * thin proxy so any external caller (worker scripts, manual curl)
 * continues to work.
 */

import { NextRequest, NextResponse } from "next/server";
import { patchPlayer, type PlayerPatchInput } from "@/app/admin/roster/actions";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: PlayerPatchInput;
  try {
    body = (await req.json()) as PlayerPatchInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const result = await patchPlayer(id, body);
  if (!result.ok) {
    const status = result.error?.includes("Forbidden") ? 403 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
