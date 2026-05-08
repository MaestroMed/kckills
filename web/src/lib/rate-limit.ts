/**
 * rate-limit.ts — Wave 18 (2026-05-08)
 *
 * Tiny helper around `fn_check_rate_limit` (migration 055). Hashes
 * the caller IP into an opaque key and asks Postgres "am I over my
 * window for this route ?" in one round-trip. Returns a NextResponse
 * 429 to short-circuit the route handler when the answer is no.
 *
 * Usage in an API route :
 *
 *   import { rateLimit } from "@/lib/rate-limit";
 *
 *   export async function GET(req: NextRequest) {
 *     const limit = await rateLimit(req, "scroll-recommendations", { windowSec: 60, max: 30 });
 *     if (limit.blocked) return limit.response;
 *     // ... real handler
 *   }
 *
 * Failure mode : if the RPC fails (DB unavailable), we FAIL OPEN
 * and let the request through. Logging happens but the route stays
 * usable — rate limiting is a soft fence, not a hard auth gate.
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

import { createAnonSupabase } from "@/lib/supabase/server";

interface RateLimitOptions {
  /** Window size in seconds (1-86400). */
  windowSec: number;
  /** Max calls per window. */
  max: number;
}

interface RateLimitResult {
  blocked: boolean;
  /** Populated when blocked = true. The route handler should return this. */
  response?: NextResponse;
  /** Raw count + reset for headers / logging. */
  current?: number;
  resetsAt?: string;
}

const HASH_SECRET = process.env.KCKILLS_RATE_LIMIT_SECRET ?? "kc-rate-limit-fallback";

function hashIp(ip: string): string {
  return crypto
    .createHmac("sha256", HASH_SECRET)
    .update(ip)
    .digest("hex")
    .slice(0, 24);
}

function extractIp(req: NextRequest): string {
  // Vercel + most proxies set x-forwarded-for. First entry is the
  // origin client ; subsequent entries are intermediate hops.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();

  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();

  // Falls back to a deterministic non-IP token so the RPC still
  // gets a stable key (rate limit per-server-instance instead of
  // per-IP, but better than not limiting at all).
  return "unknown";
}

export async function rateLimit(
  req: NextRequest,
  routeKey: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const ip = extractIp(req);
  const key = `${routeKey}:${hashIp(ip)}`;

  try {
    const sb = createAnonSupabase();
    const { data, error } = await sb.rpc("fn_check_rate_limit", {
      p_key: key,
      p_window_s: opts.windowSec,
      p_limit: opts.max,
    });
    if (error) {
      // Fail-open : return blocked=false, log via console.
      console.warn("[rate-limit] RPC failed (failing open)", error.message);
      return { blocked: false };
    }
    // PostgREST returns a single-row table as an array.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { blocked: false };

    if (!row.allowed) {
      return {
        blocked: true,
        current: row.current_count,
        resetsAt: row.window_resets_at,
        response: NextResponse.json(
          {
            error: "Rate limit exceeded",
            limit: opts.max,
            window_seconds: opts.windowSec,
            retry_after: row.window_resets_at,
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(opts.windowSec),
              "X-RateLimit-Limit": String(opts.max),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": row.window_resets_at,
            },
          },
        ),
      };
    }

    return {
      blocked: false,
      current: row.current_count,
      resetsAt: row.window_resets_at,
    };
  } catch (e) {
    // Same fail-open : networking / DNS / cold-start errors must
    // not take public endpoints offline.
    console.warn("[rate-limit] threw (failing open)", (e as Error).message);
    return { blocked: false };
  }
}
