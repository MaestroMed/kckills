/**
 * /api/kills/[id]/react — persisted emoji reactions (Vague 2).
 *
 * GET  → aggregate counts per emoji ({ counts: { "🔥": 12, ... } }).
 * POST → { emoji, delta? } increments the caller's reaction row.
 *
 * Identity (arbitrage produit 2026-07-05, "hybride") :
 *   - signed-in  → user_id (cross-device, deduped per account)
 *   - anonymous  → server-computed fingerprint hash(ip + user-agent) —
 *     reactions are low-stakes social proof, so anonymous writes are
 *     allowed, but rate-limited and capped per identity in the RPC.
 *
 * Writes run as service role via fn_increment_kill_reaction_v2 —
 * migration 085 keeps the table deny-all for anon/authenticated, so
 * this route is the single write path (pattern migration 083).
 */

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createAnonSupabase,
  createServerSupabase,
  createServiceSupabase,
} from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMOJIS = ["🔥", "👏", "😂", "😱", "💀", "🐐"] as const;

const Body = z.object({
  emoji: z.enum(EMOJIS),
  delta: z.number().int().min(1).max(20).optional(),
});

function anonFingerprint(req: NextRequest): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const ua = req.headers.get("user-agent") ?? "";
  const secret = process.env.KCKILLS_RATE_LIMIT_SECRET ?? "kc-reactions";
  return createHash("sha256").update(`${secret}:${ip}:${ua}`).digest("hex").slice(0, 32);
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }
  const sb = createAnonSupabase();
  const { data, error } = await sb.rpc("fn_kill_reaction_counts", {
    p_kill_id: id,
  });
  if (error) {
    return NextResponse.json({ ok: true, counts: {} });
  }
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { emoji: string; total: number }[]) {
    counts[row.emoji] = Number(row.total);
  }
  return NextResponse.json(
    { ok: true, counts },
    // Small shared cache — reaction counts don't need to be realtime
    // and this keeps N viewers of the same clip from stampeding.
    { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } },
  );
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }

  // 60 reaction POSTs / 5 min / IP — generous for a tap-happy fan,
  // hostile to a spam loop. Client batches taps (800 ms) upstream.
  const rl = await rateLimit(req, "kill-react", { windowSec: 300, max: 60 });
  if (rl.blocked && rl.response) return rl.response;

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "bad payload" }, { status: 400 });
  }

  let userId: string | null = null;
  try {
    const auth = await createServerSupabase();
    const {
      data: { user },
    } = await auth.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }

  const svc = createServiceSupabase();
  if (!svc) {
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }

  const { data, error } = await svc.rpc("fn_increment_kill_reaction_v2", {
    p_kill_id: id,
    p_emoji: parsed.data.emoji,
    p_user_id: userId,
    p_fingerprint: userId ? null : anonFingerprint(req),
    p_delta: parsed.data.delta ?? 1,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, myCount: data ?? 1 });
}
