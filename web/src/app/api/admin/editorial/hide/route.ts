/**
 * /api/admin/editorial/hide
 *
 * Wave 18 — admin form migrated to Server Actions
 * (see web/src/app/admin/editorial/actions.ts). Kept as a thin proxy
 * for external integrations.
 */

import { NextRequest, NextResponse } from "next/server";
import { toggleKillHide, type HideInput } from "@/app/admin/editorial/actions";

export async function POST(request: NextRequest) {
  let body: HideInput;
  try {
    body = (await request.json()) as HideInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const result = await toggleKillHide(body);
  if (!result.ok) {
    const status = result.error?.includes("Forbidden")
      ? 403
      : result.error?.includes("not found")
        ? 404
        : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, kill_visible: result.kill_visible });
}
