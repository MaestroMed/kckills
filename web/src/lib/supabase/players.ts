/**
 * Server-side helper: fetch the id → ign map for every KC player in the DB.
 *
 * Used by the homepage grid to render the `killer_player_id` axis with
 * readable IGNs (Caliste, Yike, Canna…) instead of UUIDs. Cached by the
 * RSC caller via `export const revalidate = 60`.
 */

import "server-only";
import { createServerSupabase, rethrowIfDynamic } from "./server";

export interface PlayerRow {
  id: string;
  ign: string;
  role: string | null;
  image_url: string | null;
}

export async function getTrackedRoster(): Promise<PlayerRow[]> {
  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase
      .from("players")
      .select("id, ign, role, image_url, teams!inner(is_tracked)")
      .eq("teams.is_tracked", true);
    if (error) {
      console.warn("[supabase/players] getTrackedRoster error:", error.message);
      return [];
    }
    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id ?? ""),
      ign: String(r.ign ?? "?"),
      role: (r.role as string | null) ?? null,
      image_url: (r.image_url as string | null) ?? null,
    }));
  } catch (err) {
    rethrowIfDynamic(err);
    console.warn("[supabase/players] getTrackedRoster threw:", err);
    return [];
  }
}
