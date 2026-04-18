import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * /api/healthz — uptime monitor target.
 *
 * Returns:
 *   200 + { ok: true,  ... }   when Supabase reachable + query works
 *   503 + { ok: false, ... }   when DB is down / network errors
 *
 * Cheap by design: one indexed COUNT on `kills WHERE status='published'`
 * limited to head=true so no rows travel back. Easy to point UptimeRobot,
 * BetterUptime, or Vercel Cron at.
 *
 * Cached 0s (always fresh — that's the point of a healthcheck).
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

interface HealthPayload {
  ok: boolean;
  service: "kckills.com";
  timestamp: string;
  uptime_ms: number;
  checks: {
    supabase: { ok: boolean; latency_ms?: number; published_kills?: number; error?: string };
  };
  build?: {
    commit?: string;
    region?: string;
  };
}

const STARTED_AT = Date.now();

export async function GET() {
  const supabaseStart = Date.now();
  let supabaseCheck: HealthPayload["checks"]["supabase"];
  try {
    const supabase = await createServerSupabase();
    const { count, error } = await supabase
      .from("kills")
      .select("id", { count: "exact", head: true })
      .eq("status", "published");
    if (error) {
      supabaseCheck = { ok: false, error: error.message, latency_ms: Date.now() - supabaseStart };
    } else {
      supabaseCheck = {
        ok: true,
        latency_ms: Date.now() - supabaseStart,
        published_kills: count ?? 0,
      };
    }
  } catch (err) {
    supabaseCheck = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latency_ms: Date.now() - supabaseStart,
    };
  }

  const ok = supabaseCheck.ok;
  const payload: HealthPayload = {
    ok,
    service: "kckills.com",
    timestamp: new Date().toISOString(),
    uptime_ms: Date.now() - STARTED_AT,
    checks: { supabase: supabaseCheck },
    build: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
      region: process.env.VERCEL_REGION,
    },
  };

  return NextResponse.json(payload, {
    status: ok ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/json",
    },
  });
}
