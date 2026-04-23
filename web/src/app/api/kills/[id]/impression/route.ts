import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * POST /api/kills/[id]/impression — record one view.
 *
 * Calls the `fn_record_impression(p_kill_id UUID)` RPC defined in
 * migration 001. The RPC does an UPDATE kills SET impression_count =
 * impression_count + 1 WHERE id = $1 — minimal egress, no SELECT.
 *
 * Anonymous (no auth check). Idempotency is best-effort client-side
 * (the hook calls this at most once per active-clip session). At
 * scale we could add a per-IP-per-killid bloom filter to dedup spam,
 * but for the pilot the noise floor is fine.
 *
 * Returns 204 (no body) on success — we don't need to ship the new
 * count back, the UI doesn't display it real-time.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  // UUID sanity check — prevents calling RPC with garbage that would
  // 500 on the Supabase side.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "invalid uuid" }, { status: 400 });
  }
  try {
    const sb = await createServerSupabase();
    const { error } = await sb.rpc("fn_record_impression", { p_kill_id: id });
    if (error) {
      console.warn("[api/kills/impression] rpc error:", error.message);
      // Don't surface to user — impression tracking is fire-and-forget.
      return new NextResponse(null, { status: 204 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.warn("[api/kills/impression] threw:", err);
    return new NextResponse(null, { status: 204 });
  }
}
