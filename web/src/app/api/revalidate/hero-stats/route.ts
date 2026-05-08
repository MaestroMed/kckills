/**
 * /api/revalidate/hero-stats — Wave 15 (2026-05-08)
 *
 * POST endpoint the worker hits after writing a new completed match,
 * to immediately invalidate the homepage hero-stats cache (otherwise
 * users see stale data up to the 5-minute TTL).
 *
 * Server Actions can't be called via HTTP from external clients in
 * a stable way (Next emits per-build action IDs), so we expose a
 * thin route that delegates to `revalidateHeroStats`.
 *
 * Body : `{ token: string }` — must match `KCKILLS_REVALIDATE_TOKEN`.
 * 200 → revalidated. 400 → missing token. 401 → bad token / unconfigured.
 */
import { NextResponse } from "next/server";

import { revalidateHeroStats } from "@/lib/supabase/server-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { token?: string }
    | null;
  if (!body?.token) {
    return NextResponse.json(
      { ok: false, error: "Missing token" },
      { status: 400 },
    );
  }
  const result = await revalidateHeroStats(body.token);
  return NextResponse.json(result, { status: result.ok ? 200 : 401 });
}
