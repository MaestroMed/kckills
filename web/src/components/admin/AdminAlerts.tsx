import Link from "next/link";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Bandeau d'alertes en haut de chaque page admin (server component).
 * N'affiche rien quand tout va bien. Trois signaux :
 *   · worker arrêté depuis plus de 30 min (info : l'arrêt peut être voulu) ;
 *   · quota ou plafond de coût Gemini du jour épuisé (le worker n'analyse plus) ;
 *   · plus de 20 nouveaux échecs définitifs (DLQ) en 24 h.
 * Les mêmes seuils alimentent le cron /api/cron/heartbeat-check (Discord).
 */
const DLQ_24H_THRESHOLD = 20;

export async function AdminAlerts() {
  const sb = createServiceSupabase();
  if (!sb) return null;
  const since = new Date(Date.now() - 86400e3).toISOString();
  const [hb, dlq] = await Promise.all([
    sb.from("health_checks").select("last_seen, metrics").eq("id", "worker_heartbeat").maybeSingle(),
    sb.from("dead_letter_jobs").select("id", { count: "exact", head: true }).eq("resolution_status", "pending").gte("failed_at", since),
  ]);

  const alerts: { tone: "info" | "warn" | "bad"; text: string; href: string }[] = [];
  const lastSeen = hb.data?.last_seen as string | undefined;
  const ageMin = lastSeen ? (Date.now() - Date.parse(lastSeen)) / 60000 : Infinity;
  if (ageMin > 30) {
    const h = ageMin === Infinity ? null : ageMin < 120 ? `${Math.round(ageMin)} min` : ageMin < 2880 ? `${Math.round(ageMin / 60)} h` : `${Math.round(ageMin / 1440)} j`;
    alerts.push({ tone: "info", text: h ? `Worker arrêté depuis ${h}. La file n'avance pas.` : "Le worker n'a jamais envoyé de signe de vie.", href: "/admin/pipeline" });
  }
  const sched = (hb.data?.metrics as { scheduler?: { daily_remaining?: Record<string, number>; daily_cost_remaining_usd?: Record<string, number> } } | null)?.scheduler;
  if (ageMin <= 30 && (sched?.daily_remaining?.gemini === 0 || sched?.daily_cost_remaining_usd?.gemini === 0)) {
    alerts.push({ tone: "warn", text: "Quota Gemini du jour épuisé : plus d'analyse avant 07:00 UTC.", href: "/admin/ai-costs" });
  }
  if ((dlq.count ?? 0) > DLQ_24H_THRESHOLD) {
    alerts.push({ tone: "bad", text: `${dlq.count} nouveaux échecs définitifs en 24 h.`, href: "/admin/pipeline/dlq" });
  }
  if (!alerts.length) return null;

  const tones = {
    info: "border-[var(--cyan)]/30 bg-[var(--cyan)]/5 text-[var(--cyan)]",
    warn: "border-[var(--orange)]/40 bg-[var(--orange)]/10 text-[var(--orange)]",
    bad: "border-[var(--red)]/40 bg-[var(--red)]/10 text-[var(--red)]",
  };
  return (
    <div role="status" className="flex flex-col gap-1.5 px-4 pt-3 md:px-6">
      {alerts.map((a) => (
        <Link key={a.text} href={a.href} className={`block rounded-md border px-3 py-1.5 text-xs hover:brightness-125 ${tones[a.tone]}`}>
          {a.text} <span className="opacity-70">Voir →</span>
        </Link>
      ))}
    </div>
  );
}
