/**
 * /admin/ai-costs — ce que coûte l'IA.
 *
 * Source : ai_annotations (une ligne par analyse de clip, avec cost_usd et
 * le modèle). Les lectures de chrono et le QC ne sont pas enregistrés en
 * base : ils n'apparaissent que dans le compteur du jour du worker
 * (heartbeat), affiché en tête.
 */
import type { Metadata } from "next";
import { adminPageDb } from "@/lib/admin/db";
import { fetchAll } from "@/lib/admin/paginate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Coûts IA — Admin", robots: { index: false, follow: false } };

interface Row {
  created_at: string;
  cost_usd: number | string | null;
  model_name: string;
}

const DAYS = 30;
const usd = (n: number) => `${n.toFixed(n < 10 ? 2 : 0)} $`;

export default async function AiCostsPage() {
  const sb = await adminPageDb();
  const since = new Date(Date.now() - DAYS * 86400e3);
  since.setUTCHours(0, 0, 0, 0);

  const [rows, hb] = await Promise.all([
    fetchAll<Row>((from, to) =>
      sb
        .from("ai_annotations")
        .select("created_at, cost_usd, model_name")
        .gte("created_at", since.toISOString())
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    sb.from("health_checks").select("last_seen, metrics").eq("id", "worker_heartbeat").maybeSingle(),
  ]);

  const byDay = new Map<string, { cost: number; n: number }>();
  for (let i = DAYS; i >= 0; i--) {
    byDay.set(new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10), { cost: 0, n: 0 });
  }
  const byModel = new Map<string, { cost: number; n: number }>();
  let total = 0;
  for (const r of rows) {
    const c = Number(r.cost_usd ?? 0) || 0;
    total += c;
    const d = byDay.get(r.created_at.slice(0, 10));
    if (d) {
      d.cost += c;
      d.n++;
    }
    const m = byModel.get(r.model_name) ?? { cost: 0, n: 0 };
    m.cost += c;
    m.n++;
    byModel.set(r.model_name, m);
  }
  const days = [...byDay.entries()];
  const maxCost = Math.max(0.01, ...days.map(([, v]) => v.cost));
  const last7 = days.slice(-7).reduce((s, [, v]) => s + v.cost, 0);
  const now = new Date();
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const monthSoFar = days.filter(([d]) => d >= monthStart).reduce((s, [, v]) => s + v.cost, 0);
  const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate();
  const projection = monthSoFar + (last7 / 7) * (daysInMonth - now.getUTCDate());
  const perClip = rows.length ? total / rows.length : 0;

  const sched = (hb.data?.metrics as { scheduler?: { daily_counts?: Record<string, number>; daily_cost_usd?: Record<string, number>; daily_cost_remaining_usd?: Record<string, number>; reset_date?: string } } | null)?.scheduler;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-black text-[var(--gold)]">Coûts IA</h1>
        <p className="mt-1 max-w-2xl text-xs text-[var(--text-muted)]">
          Analyses de clips enregistrées sur {DAYS} jours ({rows.length.toLocaleString("fr-FR")} appels). Les lectures de chrono et le QC ne
          sont comptés que dans le compteur du jour du worker.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { k: "Ce mois-ci", v: usd(monthSoFar) },
          { k: "Projection du mois", v: usd(projection), s: "rythme des 7 derniers jours" },
          { k: `${DAYS} derniers jours`, v: usd(total) },
          { k: "Par analyse", v: `${(perClip * 100).toFixed(2)} ¢` },
          {
            k: `Jour du worker (${sched?.reset_date ?? "—"})`,
            v: usd(sched?.daily_cost_usd?.gemini ?? 0),
            s: `${sched?.daily_counts?.gemini ?? 0} appels · plafond restant ${usd(sched?.daily_cost_remaining_usd?.gemini ?? 0)}`,
          },
        ].map((t) => (
          <div key={t.k} className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3">
            <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">{t.k}</p>
            <p className="font-data text-xl font-bold tabular-nums text-[var(--text-primary)]">{t.v}</p>
            {t.s && <p className="text-[10px] text-[var(--text-muted)]">{t.s}</p>}
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
        <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-[var(--gold)]">Par jour</h2>
        <div className="flex h-40 items-end gap-[3px]" role="img" aria-label={`Coût quotidien sur ${DAYS} jours, maximum ${usd(maxCost)}`}>
          {days.map(([d, v]) => (
            <div key={d} className="group relative flex-1" style={{ height: "100%" }}>
              <div
                className="absolute bottom-0 w-full rounded-t bg-[var(--gold)]/70 group-hover:bg-[var(--gold)]"
                style={{ height: `${Math.max(v.cost > 0 ? 2 : 0, (v.cost / maxCost) * 100)}%` }}
                title={`${d} : ${usd(v.cost)} · ${v.n} appels`}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between font-data text-[10px] text-[var(--text-muted)]">
          <span>{days[0][0]}</span>
          <span>max {usd(maxCost)} / jour</span>
          <span>{days[days.length - 1][0]}</span>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
        <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-widest text-[var(--gold)]">Par modèle</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                <th className="py-1.5 pr-4 font-normal">Modèle</th>
                <th className="py-1.5 pr-4 text-right font-normal">Appels</th>
                <th className="py-1.5 pr-4 text-right font-normal">Coût</th>
                <th className="py-1.5 text-right font-normal">Par appel</th>
              </tr>
            </thead>
            <tbody>
              {[...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([m, v]) => (
                <tr key={m} className="border-t border-[var(--border-subtle)]">
                  <td className="py-1.5 pr-4 font-mono">{m}</td>
                  <td className="py-1.5 pr-4 text-right font-data tabular-nums">{v.n.toLocaleString("fr-FR")}</td>
                  <td className="py-1.5 pr-4 text-right font-data tabular-nums">{usd(v.cost)}</td>
                  <td className="py-1.5 text-right font-data tabular-nums">{((v.cost / Math.max(1, v.n)) * 100).toFixed(2)} ¢</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 text-xs text-[var(--text-secondary)]">
        <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-widest text-[var(--gold)]">Garde-fous à garder</h2>
        <p className="mb-2 text-[var(--text-muted)]">Mis en place après l&apos;incident du 13/07/2026 (plafond mensuel Google atteint en une journée).</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Jamais de <code>GEMINI_MODEL</code> global dans <code>worker/.env</code> : il écrase le routage par tier pour tous les étages. Utiliser <code>KCKILLS_GEMINI_TIER</code> et les surcharges par étage.</li>
          <li>Chaque modèle utilisé doit avoir son prix dans <code>worker/services/ai_pricing.py</code>, sinon le plafond de 10 $/jour sous-compte.</li>
          <li>Un 429 coupe tous les process jusqu&apos;au reset de 07:00 UTC (<code>scheduler.exhaust_quota()</code>).</li>
          <li>QC sur une image, pas sur la vidéo entière (100× moins de jetons) ; chrono lu en local d&apos;abord (timer_ocr).</li>
        </ul>
      </section>
    </div>
  );
}
