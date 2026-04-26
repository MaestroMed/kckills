/**
 * POST /api/auth/riot/unlink — wipes every riot_* column on the
 * authenticated user's profile. Idempotent : a no-op when nothing was
 * linked.
 *
 * No body expected. Returns { ok: true } on success, 401 on missing
 * session, 500 on DB error.
 */

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifie" }, { status: 401 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      riot_puuid_hash: null,
      riot_summoner_name: null,
      riot_tag: null,
      riot_rank: null,
      riot_top_champions: [],
      riot_linked_at: null,
    })
    .eq("id", user.id);

  if (error) {
    console.warn("[/api/auth/riot/unlink] update failed:", error.message);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // Best-effort audit
  try {
    await supabase.from("admin_actions").insert({
      actor_id: user.id,
      actor_label: "user",
      action: "auth.riot_unlinked",
      entity_type: "profile",
      entity_id: user.id,
    });
  } catch {
    // never block on audit
  }

  return NextResponse.json({ ok: true });
}
