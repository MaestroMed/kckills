import Link from "next/link";
import type { Metadata } from "next";
import { getPublishedKills } from "@/lib/supabase/kills";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Admin Dashboard — KCKILLS",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const sb = await createServerSupabase();
  const [kills, recentActions, pendingComments] = await Promise.all([
    getPublishedKills(500),
    // PR-AUDIT : pull the strengthened columns (actor_label / actor_role)
    // so the widget shows WHO did WHAT, not just the action name.
    sb
      .from("admin_actions")
      .select("id,actor_label,actor_role,action,entity_type,entity_id,created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    sb.from("comments").select("id", { count: "exact" }).eq("moderation_status", "pending"),
  ]);

  const kcKills = kills.filter((k) => k.tracked_team_involvement === "team_killer");
  const visible = kcKills.filter((k) => k.kill_visible !== false);
  const hidden = kcKills.filter((k) => k.kill_visible === false);
  const noDesc = kcKills.filter((k) => !k.ai_description || k.ai_description.length < 40);
  const lowScore = kcKills.filter((k) => (k.highlight_score ?? 0) < 5);
  const highScore = kcKills.filter((k) => (k.highlight_score ?? 0) >= 8);
  const fakeSolos = kcKills.filter(
    (k) => k.fight_type !== "solo_kill" && k.ai_description?.toLowerCase().match(/solo kill|1v1/),
  );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-black text-[var(--gold)]">Dashboard</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">Vue d&apos;ensemble du backoffice</p>
      </header>

      {/* KPI grid */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="KC kills publiés" value={kcKills.length} />
        <KpiCard label="Visibles dans /scroll" value={visible.length} accent="green" />
        <KpiCard label="Masqués" value={hidden.length} accent="red" />
        <KpiCard label="Score ≥ 8" value={highScore.length} accent="gold" />
        <KpiCard label="Score < 5" value={lowScore.length} accent="orange" />
        <KpiCard label="Sans description" value={noDesc.length} accent={noDesc.length > 0 ? "orange" : "default"} />
        <KpiCard label="Faux solo kills" value={fakeSolos.length} accent={fakeSolos.length > 0 ? "red" : "default"} />
        <KpiCard label="Comments à modérer" value={pendingComments.count ?? 0} accent={pendingComments.count ? "orange" : "default"} />
      </section>

      {/* Quick actions */}
      <section>
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">Actions rapides</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <ActionCard
            href="/admin/clips"
            title="Clip Library"
            desc={`Naviguer / éditer / bulk operations sur ${kcKills.length} clips`}
            icon="▶"
            color="gold"
          />
          <ActionCard
            href="/admin/moderation"
            title="Comments"
            desc={`${pendingComments.count ?? 0} pending`}
            icon="✎"
            color={(pendingComments.count ?? 0) > 0 ? "red" : "default"}
          />
          <ActionCard
            href="/admin/pipeline"
            title="Pipeline"
            desc="Daemon status, jobs, trigger manuels"
            icon="◉"
            color="cyan"
          />
          <ActionCard
            href="/admin/featured"
            title="Featured du jour"
            desc="Pick le clip vedette pour la homepage"
            icon="★"
            color="gold"
          />
          <ActionCard
            href="/admin/bgm"
            title="BGM Playlist"
            desc="Tracks de fond du /scroll"
            icon="♪"
          />
          <ActionCard
            href="/admin/audit"
            title="Audit Log"
            desc="Historique de toutes les actions admin"
            icon="◎"
          />
        </div>
      </section>

      {/* Triage suggestions */}
      {(noDesc.length > 0 || fakeSolos.length > 0 || lowScore.length > 0) && (
        <section>
          <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">Triage suggéré</h2>
          <div className="space-y-2">
            {fakeSolos.length > 0 && (
              <TriageItem
                count={fakeSolos.length}
                label="Faux solo kills (description dit solo mais fight_type pas solo_kill)"
                href="/admin/clips?q=solo+kill&fight_type=skirmish_2v2"
              />
            )}
            {noDesc.length > 0 && (
              <TriageItem
                count={noDesc.length}
                label="Clips sans description correcte"
                href="/admin/clips?has_description=false"
              />
            )}
            {lowScore.length > 0 && (
              <TriageItem
                count={lowScore.length}
                label="Clips avec score < 5"
                href="/admin/clips?max_score=5"
              />
            )}
          </div>
        </section>
      )}

      {/* Recent activity — strengthened with actor + role + entity_id */}
      {recentActions.data && recentActions.data.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Recent admin activity
            </h2>
            <Link href="/admin/audit" className="text-[10px] text-[var(--cyan)] hover:underline">
              voir tout →
            </Link>
          </div>
          <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] divide-y divide-[var(--border-gold)]/30">
            {recentActions.data.map((a) => (
              <div key={a.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                <span className="font-mono text-[var(--gold)] w-32 flex-shrink-0 truncate" title={a.action}>
                  {a.action}
                </span>
                <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
                  {a.entity_type}
                </span>
                <span className="font-mono text-[10px] text-[var(--text-disabled)] truncate flex-1">
                  {a.entity_id ? a.entity_id.slice(0, 16) : "—"}
                </span>
                <span className="text-[var(--text-muted)] text-[10px] whitespace-nowrap">
                  {a.actor_label ?? "?"}
                  {a.actor_role && a.actor_role !== "unknown" ? (
                    <span className="text-[var(--text-disabled)]"> · {a.actor_role}</span>
                  ) : null}
                </span>
                <span className="text-[var(--text-disabled)] text-[10px] whitespace-nowrap">
                  {new Date(a.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function KpiCard({ label, value, accent = "default" }: { label: string; value: number; accent?: "default" | "green" | "gold" | "red" | "orange" | "cyan" }) {
  const colors: Record<string, string> = {
    default: "text-[var(--text-primary)]",
    green: "text-[var(--green)]",
    gold: "text-[var(--gold)]",
    red: "text-[var(--red)]",
    orange: "text-[var(--orange)]",
    cyan: "text-[var(--cyan)]",
  };
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
      <p className={`font-data text-3xl font-black ${colors[accent]}`}>{value}</p>
      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mt-1">{label}</p>
    </div>
  );
}

function ActionCard({ href, title, desc, icon, color = "default" }: { href: string; title: string; desc: string; icon: string; color?: "default" | "gold" | "red" | "cyan" }) {
  const accent: Record<string, string> = {
    default: "hover:border-[var(--gold)]/40",
    gold: "border-[var(--gold)]/30 hover:border-[var(--gold)]",
    red: "border-[var(--red)]/30 hover:border-[var(--red)]",
    cyan: "border-[var(--cyan)]/30 hover:border-[var(--cyan)]",
  };
  return (
    <Link
      href={href}
      className={`group rounded-xl border bg-[var(--bg-surface)] p-4 transition-all hover:-translate-y-0.5 ${accent[color]}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1">
          <h3 className="font-display text-sm font-bold text-[var(--gold)]">{title}</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{desc}</p>
        </div>
      </div>
    </Link>
  );
}

function TriageItem({ count, label, href }: { count: number; label: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-lg border border-[var(--orange)]/30 bg-[var(--orange)]/5 px-4 py-2.5 text-xs hover:bg-[var(--orange)]/10 transition-colors"
    >
      <span className="text-[var(--text-secondary)]">
        <span className="font-mono font-bold text-[var(--orange)]">{count}</span> {label}
      </span>
      <span className="text-[var(--orange)]">→</span>
    </Link>
  );
}
