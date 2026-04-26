/**
 * /admin/lab — Experiments + blind A/B harness for picking the right
 * Gemini model (PR-loltok EE polish).
 *
 * Two sections :
 *
 *   1. EXPERIMENTS — surface for production A/B tests (scroll feed
 *      algorithm tweaks, notification copy, recommendation engines,
 *      etc.). Currently no experiments wired in production — we render
 *      an empty state with explanation. The <ExperimentCard /> component
 *      is ready to consume real data once the experiments table lands.
 *
 *   2. MODEL EVALUATION — the existing blind-rank harness over Gemini
 *      2.5 Flash-Lite / 3 Flash / 2.5 Pro / 3.1 Pro Preview, generated
 *      by `worker/scripts/lab_generate_evaluations.py`. Each evaluated
 *      kill is rendered with the clip + per-model descriptions and vote
 *      buttons.
 *
 * Auth : inherits requireAdmin() from /admin/layout.tsx — no extra
 * guard at the page level.
 */
import Image from "next/image";
import { createServerSupabase } from "@/lib/supabase/server";
import { championIconUrl } from "@/lib/constants";
import { LabVoteButtons } from "./vote-buttons";
import { AdminPage, AdminSection, AdminEmptyState } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

interface LabEvaluation {
  id: string;
  kill_id: string;
  model: string;
  media_resolution: string;
  description: string;
  tags: string[] | null;
  highlight_score: number | null;
  kill_visible: boolean | null;
  caster_hype_level: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  elapsed_ms: number | null;
  user_verdict: string | null;
  user_note: string | null;
  voted_at: string | null;
  created_at: string;
}

interface KillRow {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  clip_url_vertical: string | null;
  clip_url_horizontal: string | null;
  thumbnail_url: string | null;
  multi_kill: string | null;
  is_first_blood: boolean | null;
  game_time_seconds: number | null;
  ai_description: string | null; // baseline
}

async function fetchLabData(): Promise<{
  evals: LabEvaluation[];
  kills: Map<string, KillRow>;
}> {
  const sb = await createServerSupabase();
  const { data: evals } = await sb
    .from("lab_evaluations")
    .select("*")
    .order("created_at", { ascending: false });

  const ids = Array.from(new Set((evals ?? []).map((e) => e.kill_id)));
  const killMap = new Map<string, KillRow>();
  if (ids.length > 0) {
    const { data: kills } = await sb
      .from("kills")
      .select(
        "id,killer_champion,victim_champion,clip_url_vertical,clip_url_horizontal,thumbnail_url,multi_kill,is_first_blood,game_time_seconds,ai_description",
      )
      .in("id", ids);
    for (const k of (kills as KillRow[] | null) ?? []) {
      killMap.set(k.id, k);
    }
  }
  return {
    evals: (evals ?? []) as LabEvaluation[],
    kills: killMap,
  };
}

export default async function LabPage() {
  const { evals, kills } = await fetchLabData();

  // Group evaluations by kill (used in the model-eval section)
  const byKill = new Map<string, LabEvaluation[]>();
  for (const e of evals) {
    if (!byKill.has(e.kill_id)) byKill.set(e.kill_id, []);
    byKill.get(e.kill_id)!.push(e);
  }

  // Aggregate spend
  const totalSpend = evals.reduce((acc, e) => acc + (e.cost_usd ?? 0), 0);
  const votedCount = evals.filter((e) => e.user_verdict).length;

  return (
    <AdminPage
      title="Lab"
      breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Lab" }]}
      subtitle="Expérimentations A/B + évaluation blinde des modèles Gemini"
    >
      {/* ─── EXPERIMENTS ─────────────────────────────────────────────── */}
      <AdminSection
        title="Expériences A/B"
        subtitle="Comparer feed algorithms, copies push, etc."
      >
        <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]">
          <AdminEmptyState
            icon="🧪"
            title="Aucune expérience active"
            body={
              <>
                Le Lab est la surface d&apos;A/B testing. Aucune expérience
                n&apos;est wired pour l&apos;instant — la table{" "}
                <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[var(--gold)]">
                  experiments
                </code>{" "}
                n&apos;existe pas encore en prod. Setup-en une pour
                comparer les algorithmes du scroll feed (Wilson vs
                pgvector) ou les copies de notifications push.
              </>
            }
          />
        </div>
      </AdminSection>

      {/* ─── MODEL EVALUATION ────────────────────────────────────────── */}
      <AdminSection
        title="Évaluation des modèles Gemini"
        subtitle={
          evals.length === 0
            ? "Aucune évaluation pour l'instant"
            : `${byKill.size} clips · ${evals.length} évaluations · ${votedCount} votés`
        }
        className="mt-10"
      >
        {evals.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 space-y-3">
            <p className="text-sm text-[var(--text-muted)] max-w-prose">
              Lance le générateur depuis l&apos;hôte du worker (~€0.30 de
              coût) :
            </p>
            <pre className="rounded bg-[var(--bg-elevated)] p-3 text-xs font-mono text-[var(--gold)] overflow-x-auto">
              {`cd C:/Users/Matter1/Karmine_Stats/worker
python scripts/lab_generate_evaluations.py`}
            </pre>
            <p className="text-sm text-[var(--text-muted)]">
              5 clips KC représentatifs (1 multi-kill, 1 first blood, 1 KC
              victim, 2 random highlight) sont passés dans 4 modèles :
              Gemini 2.5 Flash-Lite, 3 Flash, 2.5 Pro, 3.1 Pro Preview.
              Recharge cette page une fois fini.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
              <span>
                <strong className="text-white">{byKill.size}</strong> clips
              </span>
              <span>
                <strong className="text-white">{evals.length}</strong>{" "}
                évaluations
              </span>
              <span>
                <strong className="text-[var(--gold)]">{votedCount}</strong> /{" "}
                {evals.length} votés
              </span>
              <span>
                dépensé :{" "}
                <strong className="text-[var(--cyan)]">
                  ${totalSpend.toFixed(4)}
                </strong>
                <span className="text-[var(--text-disabled)]">
                  {" "}
                  (~€{(totalSpend * 0.93).toFixed(4)})
                </span>
              </span>
            </div>

            <div className="space-y-10">
              {[...byKill.entries()].map(([killId, evalsForKill]) => {
                const kill = kills.get(killId);
                if (!kill) return null;
                const clipUrl =
                  kill.clip_url_vertical || kill.clip_url_horizontal;
                const gameTimeStr = kill.game_time_seconds
                  ? `T+${Math.floor(kill.game_time_seconds / 60)}:${String(kill.game_time_seconds % 60).padStart(2, "0")}`
                  : "";

                return (
                  <section
                    key={killId}
                    className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden"
                  >
                    {/* Clip header — champions, badges, embedded video */}
                    <div className="flex flex-col lg:flex-row gap-6 p-6 border-b border-[var(--border-gold)]">
                      <div className="lg:w-2/5 flex-shrink-0">
                        <div className="relative rounded-lg overflow-hidden bg-black aspect-[9/16] max-h-[400px] mx-auto">
                          {clipUrl ? (
                            <video
                              className="w-full h-full object-contain"
                              src={clipUrl}
                              poster={kill.thumbnail_url ?? undefined}
                              controls
                              playsInline
                              preload="metadata"
                            />
                          ) : (
                            <div className="grid place-items-center h-full text-[var(--text-muted)]">
                              no clip
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="lg:w-3/5 space-y-4">
                        <div className="flex items-center gap-3 flex-wrap">
                          {kill.killer_champion && (
                            <Image
                              src={championIconUrl(kill.killer_champion)}
                              alt={kill.killer_champion}
                              width={48}
                              height={48}
                              className="rounded-md border border-[var(--gold)]/40"
                            />
                          )}
                          <span className="text-[var(--text-muted)]">→</span>
                          {kill.victim_champion && (
                            <Image
                              src={championIconUrl(kill.victim_champion)}
                              alt={kill.victim_champion}
                              width={48}
                              height={48}
                              className="rounded-md border border-[var(--red)]/40"
                            />
                          )}
                          <div>
                            <p className="font-display text-lg font-bold text-white">
                              {kill.killer_champion} → {kill.victim_champion}
                            </p>
                            <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mt-0.5">
                              {gameTimeStr}
                              {kill.multi_kill && (
                                <span className="ml-2 text-[var(--orange)]">
                                  ★ {kill.multi_kill}
                                </span>
                              )}
                              {kill.is_first_blood && (
                                <span className="ml-2 text-[var(--red)]">
                                  ★ first blood
                                </span>
                              )}
                            </p>
                          </div>
                        </div>

                        {kill.ai_description && (
                          <div className="rounded border-l-2 border-[var(--text-disabled)] bg-[var(--bg-primary)] p-3">
                            <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-1">
                              Description prod actuelle (celle vue par
                              les utilisateurs)
                            </p>
                            <p className="text-sm italic text-white/80">
                              &laquo; {kill.ai_description} &raquo;
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Per-model evaluation cards */}
                    <div className="p-6 grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                      {evalsForKill.map((e) => (
                        <article
                          key={e.id}
                          className={`rounded-xl border p-4 transition-colors ${
                            e.user_verdict
                              ? "border-[var(--gold)]/40 bg-[var(--bg-elevated)]"
                              : "border-[var(--border-gold)] bg-[var(--bg-primary)]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div>
                              <p className="font-data text-[10px] uppercase tracking-widest text-[var(--gold)]">
                                {e.model}
                              </p>
                              <p className="text-[9px] text-[var(--text-disabled)] mt-0.5">
                                ${e.cost_usd?.toFixed(5) ?? "?"} ·{" "}
                                {e.elapsed_ms ? `${e.elapsed_ms}ms` : "?"} ·{" "}
                                score {e.highlight_score?.toFixed(1) ?? "?"}/10
                              </p>
                            </div>
                            {e.user_verdict && (
                              <span className="rounded-full bg-[var(--gold)]/15 border border-[var(--gold)]/30 px-2 py-0.5 text-[9px] uppercase tracking-widest text-[var(--gold)]">
                                {e.user_verdict}
                              </span>
                            )}
                          </div>

                          <p className="text-sm leading-relaxed text-white/90 italic">
                            &laquo; {e.description} &raquo;
                          </p>

                          {e.tags && e.tags.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {e.tags.map((t) => (
                                <span
                                  key={t}
                                  className="text-[9px] font-data uppercase tracking-widest text-[var(--cyan)] bg-[var(--cyan)]/10 border border-[var(--cyan)]/20 rounded px-1.5 py-0.5"
                                >
                                  #{t}
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="mt-4 pt-3 border-t border-[var(--border-gold)]/40">
                            <LabVoteButtons
                              evalId={e.id}
                              currentVerdict={e.user_verdict}
                              currentNote={e.user_note}
                            />
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </AdminSection>
    </AdminPage>
  );
}

export const metadata = {
  title: "Lab — A/B + Modèles — KCKILLS Admin",
  robots: { index: false, follow: false },
};
