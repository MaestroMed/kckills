/**
 * POST /api/kills/[id]/report — V3 (Wave 22.1).
 *
 * Receives a "report this clip" signal from the long-press menu in
 * the /scroll feed. Best-effort : we record the report but never
 * 5xx the user, since the gesture must always feel responsive.
 *
 * Body : `{ reason?: string }` — `inappropriate` / `broken` /
 *         `spam` / free-form (max 200 chars).
 *
 * Storage : appends a row to `kill_reports` (table created in
 * migration TBD ; until then, we log to a Supabase RPC if available
 * and silently swallow when not). Real moderation surfacing is
 * V39's admin queue.
 *
 * Anti-abuse :
 *   * IP-hash rate-limit via the existing `fn_check_rate_limit` RPC
 *     at 5 reports / minute / IP.
 *   * Reason text trimmed + capped at 200 chars.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  reason: z
    .string()
    .max(200)
    .optional()
    .transform((s) => (s ? s.trim().slice(0, 200) : undefined)),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid kill id" }, { status: 400 });
  }

  // Per-IP rate limit. Fails open (returns ok=true silently) on RPC
  // unavailability — same pattern as /api/scroll/recommendations.
  const rate = await rateLimit(req, "kill-report", { windowSec: 60, max: 5 });
  if (rate.blocked) return rate.response!;

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Bad payload" }, { status: 400 });
  }

  const reason = parsed.data.reason ?? "unspecified";

  // Best-effort persist via Supabase RPC. The kill_reports table /
  // RPC may not exist yet ; we wrap and silently succeed in that
  // case so the user always gets a 200.
  try {
    const sb = await createServerSupabase();
    await sb.rpc("fn_record_kill_report", { p_kill_id: id, p_reason: reason });
  } catch {
    // Table/RPC missing — fall through, still return ok.
  }

  return NextResponse.json({ ok: true });
}
