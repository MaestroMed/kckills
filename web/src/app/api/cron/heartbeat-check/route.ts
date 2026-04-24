/**
 * /api/cron/heartbeat-check — Vercel Cron worker watchdog.
 *
 * Wired in vercel.json :
 *
 *     "crons": [
 *       { "path": "/api/cron/heartbeat-check", "schedule": "*\u002F15 * * * *" }
 *     ]
 *
 * Runs every 15 minutes on the Vercel free tier (which allows up to 2
 * cron triggers per project). The job :
 *
 *   1. Reads `health_checks` where id = 'worker_heartbeat'.
 *   2. If `last_seen` > 30 min ago (or row missing entirely), POSTs an
 *      alert to the Discord webhook in env DISCORD_ALERT_WEBHOOK_URL.
 *      This webhook MUST be different from the main pipeline webhook so
 *      we don't drown the standard activity stream — alerts go to a
 *      dedicated #alerts channel.
 *   3. Always returns 200 with a status payload so the Vercel cron
 *      logs are easy to grep when debugging.
 *
 * Auth :
 *   The route checks Authorization: Bearer ${process.env.CRON_SECRET}.
 *   Vercel automatically attaches this header to every cron invocation
 *   when CRON_SECRET is set in the project. Manual GETs without the
 *   header get 401 — that prevents external scrapers from triggering
 *   alerts at will.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

const STALE_AFTER_MS = 30 * 60 * 1000; // 30 minutes

interface HeartbeatRow {
  id: string;
  last_seen: string | null;
  metrics: Record<string, unknown> | null;
}

interface ResponsePayload {
  ok: boolean;
  status: "fresh" | "stale" | "missing" | "error";
  last_seen?: string | null;
  age_ms?: number;
  alert_sent: boolean;
  detail?: string;
}

export async function GET(request: NextRequest) {
  // ── Auth gate ───────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${cronSecret}`;
    if (authHeader !== expected) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  // ── Fetch heartbeat row ─────────────────────────────────────────
  let supabase;
  try {
    supabase = await createServerSupabase();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        status: "error",
        alert_sent: false,
        detail: `Supabase init failed: ${err instanceof Error ? err.message : String(err)}`,
      } satisfies ResponsePayload,
      { status: 200 },
    );
  }

  let row: HeartbeatRow | null = null;
  let queryError: string | null = null;
  try {
    const { data, error } = await supabase
      .from("health_checks")
      .select("id, last_seen, metrics")
      .eq("id", "worker_heartbeat")
      .maybeSingle();
    if (error) {
      queryError = error.message;
    } else {
      row = data as HeartbeatRow | null;
    }
  } catch (err) {
    queryError = err instanceof Error ? err.message : String(err);
  }

  if (queryError) {
    const sent = await sendDiscordAlert(
      `🚨 **Worker heartbeat — query failed**\nSupabase error: \`${queryError}\``,
    );
    return NextResponse.json(
      {
        ok: false,
        status: "error",
        alert_sent: sent,
        detail: queryError,
      } satisfies ResponsePayload,
      { status: 200 },
    );
  }

  if (!row || !row.last_seen) {
    const sent = await sendDiscordAlert(
      `🚨 **Worker heartbeat — MISSING**\nNo \`worker_heartbeat\` row in \`health_checks\`. The worker may have never started, or someone deleted the row.`,
    );
    return NextResponse.json(
      {
        ok: false,
        status: "missing",
        alert_sent: sent,
        last_seen: null,
      } satisfies ResponsePayload,
      { status: 200 },
    );
  }

  const lastSeenMs = Date.parse(row.last_seen);
  if (!Number.isFinite(lastSeenMs)) {
    const sent = await sendDiscordAlert(
      `🚨 **Worker heartbeat — invalid timestamp**\n\`last_seen\` value cannot be parsed: \`${row.last_seen}\``,
    );
    return NextResponse.json(
      {
        ok: false,
        status: "error",
        alert_sent: sent,
        last_seen: row.last_seen,
        detail: "Invalid last_seen timestamp",
      } satisfies ResponsePayload,
      { status: 200 },
    );
  }

  const ageMs = Date.now() - lastSeenMs;
  if (ageMs > STALE_AFTER_MS) {
    const minutes = Math.round(ageMs / 60000);
    const sent = await sendDiscordAlert(
      `🚨 **Worker heartbeat — STALE**\nLast seen \`${row.last_seen}\` (${minutes} minutes ago). Threshold is 30 min. Check the worker host.`,
    );
    return NextResponse.json(
      {
        ok: false,
        status: "stale",
        alert_sent: sent,
        last_seen: row.last_seen,
        age_ms: ageMs,
      } satisfies ResponsePayload,
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      status: "fresh",
      alert_sent: false,
      last_seen: row.last_seen,
      age_ms: ageMs,
    } satisfies ResponsePayload,
    { status: 200 },
  );
}

// ─── Discord alert sender ──────────────────────────────────────────────

async function sendDiscordAlert(content: string): Promise<boolean> {
  const url = process.env.DISCORD_ALERT_WEBHOOK_URL;
  if (!url) {
    console.warn("[heartbeat-check] DISCORD_ALERT_WEBHOOK_URL not configured — skipping alert");
    return false;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        username: "kckills heartbeat",
        allowed_mentions: { parse: [] },
      }),
    });
    if (!res.ok) {
      console.warn(`[heartbeat-check] Discord webhook ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[heartbeat-check] Discord webhook threw:", err);
    return false;
  }
}
