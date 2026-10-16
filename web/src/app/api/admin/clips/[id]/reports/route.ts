import { NextResponse } from "next/server";
import { adminRouteDb } from "@/lib/admin/db";

const REASONS: Record<string, string> = {
  wrong_clip: "Mauvais clip",
  no_kill_visible: "Kill invisible",
  wrong_player: "Mauvais joueur",
  spam: "Spam",
  toxic: "Toxique",
  other: "Autre",
};

/** GET /api/admin/clips/[id]/reports — signalements visant ce kill. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await adminRouteDb();
  if ("res" in g) return g.res;
  const { id } = await params;

  const { data, error } = await g.sb
    .from("reports")
    .select("id, reason_code, reason_text, status, created_at")
    .eq("target_type", "kill")
    .eq("target_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data ?? []).map((r) => ({
    id: r.id,
    reason: [REASONS[r.reason_code] ?? r.reason_code, r.reason_text].filter(Boolean).join(" — "),
    status: r.status,
    created_at: r.created_at,
  }));
  return NextResponse.json({ items });
}
