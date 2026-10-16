import "server-only";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  ADMIN_DB_UNAVAILABLE,
  requireAdmin,
  type AdminCheckResult,
} from "@/lib/admin/audit";

/**
 * Accès base de l'admin — lectures ET écritures au service role.
 *
 * Pourquoi : pipeline_jobs, dead_letter_jobs, worker_jobs, admin_actions,
 * health_checks, lab_evaluations, reports, user_events, push_subscriptions
 * (et les commentaires non approuvés, les kills non publiés) n'ont aucune
 * policy RLS pour anon/authenticated. Lu avec le client de session, tout
 * cela renvoie 0 ligne SANS erreur : le dashboard affichait une file à 0
 * pendant que 4 553 jobs attendaient.
 *
 * Chaque helper refait requireAdmin() lui-même : une page ou une route qui
 * obtient un client service role est forcément derrière le contrôle admin,
 * même si le layout change un jour.
 */

export type AdminDb = SupabaseClient;

/** Pages et Server Components : redirige vers /admin/login si pas admin. */
export async function adminPageDb(): Promise<AdminDb> {
  const auth = await requireAdmin();
  if (!auth.ok) redirect("/admin/login");
  const sb = createServiceSupabase();
  if (!sb) throw new Error(ADMIN_DB_UNAVAILABLE);
  return sb;
}

/**
 * Routes API : `{ sb, admin }` ou une réponse d'erreur prête à renvoyer.
 *
 *   const g = await adminRouteDb();
 *   if ("res" in g) return g.res;
 *   const { sb, admin } = g;
 */
export async function adminRouteDb(): Promise<
  { sb: AdminDb; admin: Extract<AdminCheckResult, { ok: true }> } | { res: NextResponse }
> {
  const admin = await requireAdmin();
  if (!admin.ok) return { res: NextResponse.json({ error: admin.error }, { status: 403 }) };
  const sb = createServiceSupabase();
  if (!sb) {
    console.error(`[admin] ${ADMIN_DB_UNAVAILABLE}`);
    return { res: NextResponse.json({ error: ADMIN_DB_UNAVAILABLE }, { status: 500 }) };
  }
  return { sb, admin };
}

/** Server Actions : lève si pas admin (l'action renvoie l'erreur au formulaire). */
export async function adminActionDb(): Promise<{ sb: AdminDb; admin: Extract<AdminCheckResult, { ok: true }> }> {
  const admin = await requireAdmin();
  if (!admin.ok) throw new Error(admin.error);
  const sb = createServiceSupabase();
  if (!sb) throw new Error(ADMIN_DB_UNAVAILABLE);
  return { sb, admin };
}
