"use client";

/**
 * EditorialBoard — client-side filter chips + card grid + recent
 * actions log (PR-loltok ED).
 *
 * Migrated to Agent EA's primitives :
 *   - AdminBreadcrumbs / AdminSection / AdminCard / AdminButton / AdminBadge / AdminEmptyState
 *
 * Filter chips include action-type + content filters. The action log
 * is now an AdminTable-style block with an "Annuler" button on the
 * actions that are reversible (feature.pin / feature.unpin / kill.hide
 * / kill.unhide).
 */

import { useMemo, useState } from "react";
import { EditorialCard, type EditorialCardProps } from "./editorial-card";
import { AdminBadge } from "@/components/admin/ui/AdminBadge";
import { AdminBreadcrumbs } from "@/components/admin/ui/AdminBreadcrumbs";
import { AdminButton } from "@/components/admin/ui/AdminButton";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { AdminEmptyState } from "@/components/admin/ui/AdminEmptyState";
import { AdminSection } from "@/components/admin/ui/AdminSection";

interface ActionRow {
  id: string;
  action: string;
  kill_id: string | null;
  performed_by: string | null;
  performed_at: string;
  payload: Record<string, unknown> | null;
}

type ContentFilter = "all" | "today" | "high_score" | "multi_kill" | "hidden" | "pinned";
type ActionFilter =
  | "all"
  | "feature.pin"
  | "feature.unpin"
  | "discord.push"
  | "kill.hide"
  | "kill.unhide";

const CONTENT_FILTER_LABELS: Record<ContentFilter, string> = {
  all: "Tous",
  today: "Aujourd'hui",
  high_score: "Score ≥ 8",
  multi_kill: "Multi-kills",
  hidden: "Cachés",
  pinned: "Déjà pinnés",
};

const ACTION_FILTER_LABELS: Record<ActionFilter, string> = {
  all: "Tous types",
  "feature.pin": "Pin",
  "feature.unpin": "Unpin",
  "discord.push": "Discord",
  "kill.hide": "Hide",
  "kill.unhide": "Unhide",
};

const ACTION_LABELS: Record<string, string> = {
  "feature.pin": "Pin",
  "feature.unpin": "Unpin",
  "discord.push": "Discord",
  "kill.hide": "Hide",
  "kill.unhide": "Unhide",
  "kotw.auto_pick": "KOTW auto",
};

const REVERSIBLE: Record<string, string> = {
  "feature.pin": "feature.unpin",
  "feature.unpin": "feature.pin",
  "kill.hide": "kill.unhide",
  "kill.unhide": "kill.hide",
};

interface ToastMsg {
  id: number;
  text: string;
  tone: "success" | "error" | "info";
}

function formatActionTime(iso: string): string {
  const d = new Date(iso);
  const ageMs = Date.now() - d.getTime();
  if (ageMs < 60_000) return "à l'instant";
  if (ageMs < 3_600_000) return `il y a ${Math.floor(ageMs / 60_000)} min`;
  if (ageMs < 86_400_000) return `il y a ${Math.floor(ageMs / 3_600_000)} h`;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function actionVariant(action: string): "info" | "neutral" | "warn" | "success" | "danger" {
  if (action === "feature.pin" || action === "kotw.auto_pick") return "success";
  if (action === "feature.unpin") return "neutral";
  if (action === "kill.hide") return "danger";
  if (action === "kill.unhide") return "info";
  if (action === "discord.push") return "info";
  return "neutral";
}

export function EditorialBoard({
  cards,
  actions,
}: {
  cards: EditorialCardProps[];
  actions: ActionRow[];
}) {
  const [contentFilter, setContentFilter] = useState<ContentFilter>("all");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [search, setSearch] = useState("");
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const pushToast = (text: string, tone: ToastMsg["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2800);
  };

  const filteredCards = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (contentFilter === "today" && !c.createdAt.startsWith(todayStr)) return false;
      if (contentFilter === "high_score" && (c.highlightScore ?? 0) < 8) return false;
      if (contentFilter === "multi_kill" && !c.multiKill) return false;
      if (contentFilter === "hidden" && !c.isHidden) return false;
      if (contentFilter === "pinned" && !c.pinnedFeature) return false;
      if (q) {
        const hay = `${c.killerChampion} ${c.victimChampion} ${c.aiDescription ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [cards, contentFilter, search]);

  const filteredActions = useMemo(() => {
    if (actionFilter === "all") return actions;
    return actions.filter((a) => a.action === actionFilter);
  }, [actions, actionFilter]);

  const counts: Record<ContentFilter, number> = {
    all: cards.length,
    today: cards.filter((c) => c.createdAt.startsWith(new Date().toISOString().slice(0, 10))).length,
    high_score: cards.filter((c) => (c.highlightScore ?? 0) >= 8).length,
    multi_kill: cards.filter((c) => c.multiKill).length,
    hidden: cards.filter((c) => c.isHidden).length,
    pinned: cards.filter((c) => c.pinnedFeature).length,
  };

  const undo = async (a: ActionRow) => {
    const reverse = REVERSIBLE[a.action];
    if (!reverse) return;
    if (!a.kill_id) {
      pushToast("Action sans kill_id : non réversible.", "error");
      return;
    }
    if (!confirm(`Annuler « ${ACTION_LABELS[a.action] ?? a.action} » ?`)) return;
    try {
      // Mappe l'action inverse vers l'endpoint adéquat — le payload reproduit
      // le même call que la card aurait fait à l'origine.
      let r: Response;
      if (reverse === "feature.unpin") {
        r = await fetch("/api/admin/editorial/feature", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kill_id: a.kill_id }),
        });
      } else if (reverse === "feature.pin") {
        // Re-pin avec un range par défaut de 24 h ; l'éditeur ajustera
        // depuis la card si besoin.
        const now = new Date();
        const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const to = new Date(from.getTime() + 24 * 3600 * 1000 - 1000);
        r = await fetch("/api/admin/editorial/feature", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kill_id: a.kill_id,
            valid_from: from.toISOString(),
            valid_to: to.toISOString(),
          }),
        });
      } else if (reverse === "kill.unhide" || reverse === "kill.hide") {
        r = await fetch("/api/admin/editorial/hide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kill_id: a.kill_id, hide: reverse === "kill.hide" }),
        });
      } else {
        pushToast("Annulation non implémentée.", "error");
        return;
      }
      if (r.ok) {
        pushToast("Action annulée.");
      } else {
        const e = await r.json().catch(() => ({}));
        pushToast(`Erreur : ${e.error ?? `HTTP ${r.status}`}`, "error");
      }
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Erreur réseau", "error");
    }
  };

  return (
    <div className="space-y-5">
      <AdminBreadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Éditorial" }]} />

      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-black text-[var(--gold)]">
            Éditorial
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {filteredCards.length} / {cards.length} kills
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Main column ── */}
        <div className="space-y-4">
          {/* Filter chips (content) */}
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(CONTENT_FILTER_LABELS) as ContentFilter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setContentFilter(f)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  contentFilter === f
                    ? "border-[var(--gold)]/60 bg-[var(--gold)]/15 text-[var(--gold)]"
                    : "border-[var(--border-gold)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--gold)]/40"
                }`}
              >
                {CONTENT_FILTER_LABELS[f]} <span className="ml-1 opacity-60">{counts[f]}</span>
              </button>
            ))}
          </div>

          <input
            type="search"
            placeholder="Rechercher champion, description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--gold)]/60 focus:outline-none"
            aria-label="Rechercher dans les kills"
          />

          {filteredCards.length === 0 ? (
            <AdminCard variant="default">
              <AdminEmptyState
                icon="◎"
                title="Rien à afficher"
                body="Ajuste le filtre ou la recherche."
              />
            </AdminCard>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredCards.map((c) => (
                <EditorialCard key={c.id} {...c} />
              ))}
            </div>
          )}
        </div>

        {/* ── Side column : action log ── */}
        <aside className="space-y-3 lg:sticky lg:top-20 self-start">
          <AdminSection
            title="Actions récentes"
            subtitle={`${filteredActions.length} entrée${filteredActions.length > 1 ? "s" : ""}`}
            dense
            action={
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value as ActionFilter)}
                className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1 text-[10px]"
                aria-label="Filtrer par type d'action"
              >
                {(Object.keys(ACTION_FILTER_LABELS) as ActionFilter[]).map((f) => (
                  <option key={f} value={f}>
                    {ACTION_FILTER_LABELS[f]}
                  </option>
                ))}
              </select>
            }
          >
            <AdminCard variant="dense">
              {filteredActions.length === 0 ? (
                <AdminEmptyState icon="✓" title="Aucune action récente" compact />
              ) : (
                <ol className="divide-y divide-[var(--border-gold)]/30">
                  {filteredActions.map((a) => (
                    <li key={a.id} className="px-3 py-2 text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <AdminBadge variant={actionVariant(a.action)} size="sm">
                          {ACTION_LABELS[a.action] ?? a.action}
                        </AdminBadge>
                        <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">
                          {formatActionTime(a.performed_at)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[10px]">
                        <span className="font-mono text-[var(--text-muted)] truncate">
                          {a.performed_by ?? "—"}
                        </span>
                        {REVERSIBLE[a.action] && (
                          <AdminButton variant="ghost" size="sm" onClick={() => undo(a)}>
                            Annuler
                          </AdminButton>
                        )}
                      </div>
                      {a.kill_id && (
                        <p className="text-[10px] font-mono text-[var(--text-disabled)] truncate">
                          {a.kill_id.slice(0, 12)}…
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </AdminCard>
          </AdminSection>
        </aside>
      </div>

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2 items-end pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`rounded-lg px-4 py-2 text-xs font-medium shadow-lg backdrop-blur-md ${
                t.tone === "success"
                  ? "bg-[var(--green)]/90 text-black"
                  : t.tone === "error"
                    ? "bg-[var(--red)]/90 text-white"
                    : "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-gold)]"
              }`}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Re-export for convenience.
export { EditorialCard };
