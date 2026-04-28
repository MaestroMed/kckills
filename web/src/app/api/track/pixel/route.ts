/**
 * /api/track/pixel — server-side noscript fallback tracker.
 *
 * Why this exists
 * ───────────────
 * The 2026-04-28 Cloudflare audit found we capture only ~6 % of visitors
 * via the JS tracker (`/api/track` POST from `lib/analytics/track.ts`).
 * The gap is mostly :
 *   * Strict adblockers (uBlock + privacy lists) blocking POST to /api/track
 *   * JS-disabled clients (rare but real)
 *   * Crawlers that run our HTML but not our scripts
 *
 * A 1×1 transparent GIF served from `/api/track/pixel?p=...` is invisible
 * to the user, dodges most adblock POST rules (image requests are far
 * less filtered), and works without any JS. The pixel is rendered inside
 * a `<noscript>` block in `app/layout.tsx` so it ONLY fires when the
 * tracker JS didn't run.
 *
 * Trade-offs vs /api/track POST
 * ─────────────────────────────
 *   * No batching — 1 request per page.
 *   * No metadata payload — we encode only path + locale in the query
 *     string. Anything richer (entity, session, etc.) would either
 *     leak PII into the URL or hit URL-length limits.
 *   * No session_id — we generate a per-request server-side bucket
 *     key from (ip-truncated + UA hash + day) so we can dedupe rough
 *     visitor counts without storing PII.
 *
 * The endpoint is also bot-filtered same as /api/track. Returns the
 * pixel even on bot requests (so the IMG tag doesn't 4xx in DevTools)
 * but skips the DB insert.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "edge";

// 1×1 transparent GIF (43 bytes). Hand-rolled rather than importing a
// library so the edge bundle stays minuscule.
const TRANSPARENT_GIF = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x44, 0x01, 0x00, 0x3b,
]);

const BOT_UA_RE =
  /\b(bot|crawler|spider|scraper|headlesschrome|puppeteer|playwright|phantomjs|selenium|chrome-lighthouse|gptbot|claudebot|perplexitybot|claude-web|anthropic-ai|chatgpt|googleother|bytespider|amazonbot|applebot|baiduspider|bingbot|cohere-ai|duckduckbot|facebookexternalhit|google-extended|googlebot|linkedinbot|meta-externalagent|petalbot|pinterestbot|semrushbot|slackbot|telegrambot|twitterbot|whatsapp|yandexbot)\b/i;

const PIXEL_HEADERS: Record<string, string> = {
  "Content-Type": "image/gif",
  // Don't cache — we want a fresh hit per page view.
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
};

/**
 * Cheap stable visitor bucket from headers, no PII storage.
 * - Truncate IPv4 to /24 (IPv6 to /48) so we don't store full IPs
 * - Hash the truncated IP + UA + day → opaque session bucket
 *
 * Only used to estimate unique-visitor counts ; never reversed.
 */
async function visitorBucket(req: NextRequest): Promise<string> {
  const ip = (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "0.0.0.0"
  );
  const ua = req.headers.get("user-agent") || "";
  // /24 truncate for IPv4 — drops the host octet
  let ipBucket = ip;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    ipBucket = ip.split(".").slice(0, 3).join(".") + ".0";
  } else if (ip.includes(":")) {
    // IPv6 /48 truncate — first 3 hextets
    ipBucket = ip.split(":").slice(0, 3).join(":") + "::0";
  }
  const day = new Date().toISOString().slice(0, 10);
  const raw = `${ipBucket}|${ua}|${day}`;
  // SHA-256 → hex, take first 16 chars for the session key.
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export async function GET(request: NextRequest) {
  // Always return the GIF, even on bots / errors — the IMG tag in the
  // browser must succeed to avoid console noise. Skip the DB insert
  // when the request looks bot-driven.
  const ua = request.headers.get("user-agent") || "";
  const isBot = ua.length < 10 || BOT_UA_RE.test(ua);

  // Don't await DB insert if we don't need to ; never await it on the
  // response path (would delay the pixel return).
  if (!isBot) {
    queueMicrotask(async () => {
      try {
        const url = new URL(request.url);
        const path = url.searchParams.get("p")?.slice(0, 200) || "/";
        const locale = url.searchParams.get("l")?.slice(0, 8) || null;
        const supabase = await createServerSupabase();
        const session = await visitorBucket(request);
        await supabase.from("user_events").insert({
          event_type: "page.viewed",
          session_id: session,
          anonymous_user_id: session,
          metadata: { path, source: "pixel" },
          locale: /^[a-z]{2}$/i.test(locale ?? "") ? locale!.toLowerCase() : null,
          client_kind: null,
          network_class: null,
        });
      } catch {
        // Silent — pixel is best-effort.
      }
    });
  }

  return new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: PIXEL_HEADERS,
  });
}
