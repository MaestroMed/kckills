import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Enregistre la note (1-5) d'un utilisateur, ou la retire (0).
 *
 * Pourquoi pas un upsert : la migration 083 ne donne à `authenticated` que
 * `UPDATE (score)` sur `ratings`, et un upsert PostgREST met à jour TOUTES les
 * colonnes envoyées (kill_id, user_id…) → « permission denied for table
 * ratings » pour tout le monde, même à la première note (constaté le
 * 29/09/2026 : aucune note n'avait jamais pu être enregistrée).
 *
 * Donc : mise à jour de SA note (colonne score, politique « Own rating
 * update »), sinon insertion (« Auth insert rating »). Le retrait passe par
 * le service role : aucune politique DELETE n'existe sur `ratings`, un
 * DELETE de session supprimait 0 ligne sans erreur. `userId` vient toujours
 * de la session vérifiée par l'appelant.
 */
export async function saveRating(
  supabase: SupabaseClient,
  killId: string,
  userId: string,
  score: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (score === 0) {
    const svc = createServiceSupabase();
    if (!svc) return { ok: false, error: "Service indisponible" };
    const { error } = await svc.from("ratings").delete().eq("kill_id", killId).eq("user_id", userId);
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const upd = await supabase.from("ratings").update({ score }).eq("kill_id", killId).eq("user_id", userId).select("id");
  if (upd.error) return { ok: false, error: upd.error.message };
  if ((upd.data ?? []).length > 0) return { ok: true };

  const ins = await supabase.from("ratings").insert({ kill_id: killId, user_id: userId, score });
  if (!ins.error) return { ok: true };
  // Course : la note a été créée entre-temps (double tap) → on met à jour.
  if (ins.error.code === "23505") {
    const again = await supabase.from("ratings").update({ score }).eq("kill_id", killId).eq("user_id", userId);
    return again.error ? { ok: false, error: again.error.message } : { ok: true };
  }
  return { ok: false, error: ins.error.message };
}
