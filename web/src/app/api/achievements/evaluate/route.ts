/**
 * /api/achievements/evaluate — fire after a successful user action.
 *
 * POST body : { session?: string }
 *   - if the request has an authed Supabase session, evaluates against
 *     that user_id and returns any newly-earned slugs
 *   - else if `session` is a >= 16-char hex, evaluates against the anon
 *     session_hash
 *   - else returns an empty list
 *
 * Used by the client toast component (AchievementToast) which polls
 * every 30s + fires manually after rating / commenting / voting. Cheap
 * RPC, idempotent on the DB side, so accidental double-fires never
 * inflate counts.
 */

import { NextRequest, NextResponse } from "next/server";

import { evaluateAchievements } from "@/lib/supabase/achievements";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let session: string | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as { session?: unknown };
    if (typeof body.session === "string" && body.session.length >= 16) {
      session = body.session;
    }
  } catch {
    // no body — fine
  }

  // Prefer the authed user_id over the anon session.
  let userId: string | null = null;
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }

  const unlocks = await evaluateAchievements({
    userId,
    sessionHash: session,
  });

  return NextResponse.json({ ok: true, unlocks });
}
