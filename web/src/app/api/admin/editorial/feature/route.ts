/**
 * /api/admin/editorial/feature
 *
 * Wave 18 — admin form migrated to Server Actions
 * (see web/src/app/admin/editorial/actions.ts). Kept as a thin proxy
 * so external integrations (worker, kill_of_the_week scheduler) keep
 * working unchanged.
 */

import { NextRequest, NextResponse } from "next/server";
import { pinFeature, type FeaturePinInput } from "@/app/admin/editorial/actions";

export async function POST(request: NextRequest) {
  let body: FeaturePinInput;
  try {
    body = (await request.json()) as FeaturePinInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const result = await pinFeature(body);
  if (!result.ok) {
    const status = result.error?.includes("Forbidden")
      ? 403
      : result.error?.includes("not found")
        ? 404
        : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, feature_date: result.feature_date });
}
