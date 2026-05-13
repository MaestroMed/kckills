/**
 * GET /c/[shortCode]/status.json — polling endpoint for the builder.
 *
 * The CompilationBuilder success view polls this every 10 s after
 * submission. We expose the minimum payload it needs : current
 * status, output URL (when done), and the render error (when
 * failed). Anything else stays gated behind the full viewer page.
 *
 * Why a JSON twin of the viewer instead of a `?format=json` flag :
 *   • Keeps the viewer page free of branch logic (its props are always
 *     server-rendered HTML).
 *   • Lets us cache the JSON aggressively at the edge for done rows
 *     (1 hour) while keeping pending/rendering rows uncached.
 */

import { NextResponse } from "next/server";

import { getCompilationByShortCode } from "@/lib/supabase/compilations";

export const runtime = "nodejs";
// We intentionally don't set `revalidate` here — the polling client
// uses cache: "no-store" anyway and we want each tick to see the
// freshest DB state. Done rows still benefit from the per-route
// React cache() dedup inside getCompilationByShortCode.

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ shortCode: string }> },
) {
  const { shortCode } = await ctx.params;

  const row = await getCompilationByShortCode(shortCode);
  if (!row) {
    return NextResponse.json(
      { status: "not_found" as const, outputUrl: null, renderError: null },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      status: row.status,
      outputUrl: row.outputUrl,
      renderError: row.renderError,
      outputDurationSeconds: row.outputDurationSeconds,
      viewCount: row.viewCount,
    },
    {
      headers: {
        "Cache-Control":
          row.status === "done"
            ? "public, s-maxage=300, stale-while-revalidate=900"
            : "no-store",
      },
    },
  );
}
