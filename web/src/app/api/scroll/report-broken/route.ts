/**
 * Beacon endpoint hit by /scroll when a <video> errors out.
 *
 * Goal: get a server-side log line every time a clip URL is dead so we can
 * grep Vercel logs for `scroll.report-broken` and reconcile against Supabase.
 *
 * Intentionally minimal: no auth, no rate limit, no DB write. The endpoint
 * only logs — a worker job is responsible for the actual cleanup. We never
 * trust client reports as ground truth (anyone could DoS-mark every clip
 * as broken if we auto-deleted).
 */

import { NextResponse } from "next/server";

export const runtime = "edge";

interface Body {
  kind?: "video" | "moment";
  id?: string;
  src?: string;
}

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const kind = body.kind === "moment" ? "moment" : "video";
  const id = typeof body.id === "string" ? body.id.slice(0, 64) : "";
  const src = typeof body.src === "string" ? body.src.slice(0, 512) : "";

  if (!id) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Single-line, grep-friendly. Vercel logs > query "scroll.report-broken"
  // > export the unique IDs > run a Supabase cleanup script.
  console.warn(
    `scroll.report-broken kind=${kind} id=${id} src=${src}`,
  );

  return NextResponse.json({ ok: true });
}
