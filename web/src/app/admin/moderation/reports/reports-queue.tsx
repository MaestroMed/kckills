"use client";

/**
 * ReportsQueue — admin moderation dashboard for the user-triggered
 * reports table (migration 032). PR-loltok EE polish.
 *
 * Mental model : "what target needs attention", not "what individual
 * report" — multiple reports against the same kill / comment collapse
 * into a single triage card with a count badge.
 *
 * Per-card actions :
 *   - View target (link to /kill/[id] or admin clip detail)
 *   - Hide target (POST /api/admin/moderation/reports/hide-target —
 *     flips kill_visible=false AND publication_status='hidden', or
 *     comments.is_deleted=true, or community_clips.approved=false)
 *   - Dismiss (POST /api/admin/moderation/reports/dismiss — closes
 *     the reports without touching the target)
 *
 * Filters : status (pending/actioned/dismissed) · reason_code · target_type.
 * Confirm dialog before destructive (hide).
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  AdminPage,
  AdminCard,
  AdminButton,
  AdminFilterChips,
  AdminEmptyState,
  useAdminToast,
} from "@/components/admin/ui";
import {
  ReportTriageCard,
  type ReportTriageGroup,
} from "@/components/admin/moderation/ReportTriageCard";

type StatusFilter = "pending" | "actioned" | "dismissed";

const STATUS_CHIPS: { id: StatusFilter; label: string }[] = [
  { id: "pending", label: "À traiter" },
  { id: "actioned", label: "Actionnés" },
  { id: "dismissed", label: "Rejetés" },
];

type TargetTypeFilter = "all" | "kill" | "comment" | "community_clip";

const TARGET_CHIPS: { id: TargetTypeFilter; label: string }[] = [
  { id: "all", label: "Toutes cibles" },
  { id: "kill", label: "Kills" },
  { id: "comment", label: "Commentaires" },
  { id: "community_clip", label: "Community" },
];

type ReasonFilter =
  | "all"
  | "wrong_clip"
  | "no_kill_visible"
  | "wrong_player"
  | "spam"
  | "toxic"
  | "harassment"
  | "other";

const REASON_CHIPS: { id: ReasonFilter; label: string }[] = [
  { id: "all", label: "Toutes raisons" },
  { id: "wrong_clip", label: "Mauvais clip" },
  { id: "no_kill_visible", label: "Kill invisible" },
  { id: "wrong_player", label: "Mauvais joueur" },
  { id: "spam", label: "Spam" },
  { id: "toxic", label: "Toxique" },
  { id: "harassment", label: "Harcèlement" },
  { id: "other", label: "Autre" },
];

export function ReportsQueue() {
  const toast = useAdminToast();
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [targetType, setTargetType] = useState<TargetTypeFilter>("all");
  const [reason, setReason] = useState<ReasonFilter>("all");
  const [groups, setGroups] = useState<ReportTriageGroup[]>([]);
  const [totalGroups, setTotalGroups] = useState(0);
  const [totalReports, setTotalReports] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/admin/moderation/reports?status=${status}&limit=200`,
      );
      if (r.ok) {
        const data: {
          groups?: ReportTriageGroup[];
          total_groups?: number;
          total_reports?: number;
        } = await r.json();
        setGroups(data.groups ?? []);
        setTotalGroups(data.total_groups ?? 0);
        setTotalReports(data.total_reports ?? 0);
      } else {
        setGroups([]);
        setTotalGroups(0);
        setTotalReports(0);
        toast.error("Échec du chargement");
      }
    } catch (e) {
      toast.error(`Erreur réseau : ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [status, toast]);

  useEffect(() => {
    void fetchGroups();
  }, [fetchGroups]);

  // Client-side filter on top of the status fetch (cheap, no extra trip).
  const filteredGroups = useMemo(() => {
    return groups.filter((g) => {
      if (targetType !== "all" && g.target_type !== targetType) return false;
      if (reason !== "all" && !g.reasons.includes(reason)) return false;
      return true;
    });
  }, [groups, targetType, reason]);

  const labelForTargetType = (t: string): string => {
    if (t === "kill") return "kill";
    if (t === "comment") return "commentaire";
    if (t === "community_clip") return "clip communautaire";
    return t;
  };

  const hideTarget = async (g: ReportTriageGroup) => {
    if (
      !window.confirm(
        `Masquer ce ${labelForTargetType(g.target_type)} et clôturer ${g.count} signalement(s) ?\nCette action est destructive.`,
      )
    )
      return;
    const key = `${g.target_type}:${g.target_id}`;
    setBusyTarget(key);
    try {
      const r = await fetch(
        "/api/admin/moderation/reports/hide-target",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetType: g.target_type,
            targetId: g.target_id,
            reportIds: g.reports.map((rep) => rep.id),
          }),
        },
      );
      if (r.ok) {
        toast.success(`${labelForTargetType(g.target_type)} masqué`);
        await fetchGroups();
      } else {
        const j = await r.json().catch(() => ({}));
        toast.error(`Erreur : ${j.error ?? r.statusText}`);
      }
    } finally {
      setBusyTarget(null);
    }
  };

  const dismissReports = async (g: ReportTriageGroup) => {
    if (
      g.count >= 3 &&
      !window.confirm(
        `Rejeter ${g.count} signalement(s) sans action sur le ${labelForTargetType(g.target_type)} ?`,
      )
    )
      return;
    const key = `${g.target_type}:${g.target_id}`;
    setBusyTarget(key);
    try {
      const r = await fetch("/api/admin/moderation/reports/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportIds: g.reports.map((rep) => rep.id),
        }),
      });
      if (r.ok) {
        toast.info(`${g.count} signalement(s) rejeté(s)`);
        await fetchGroups();
      } else {
        const j = await r.json().catch(() => ({}));
        toast.error(`Erreur : ${j.error ?? r.statusText}`);
      }
    } finally {
      setBusyTarget(null);
    }
  };

  return (
    <AdminPage
      title="Signalements"
      breadcrumbs={[
        { label: "Admin", href: "/admin" },
        { label: "Modération", href: "/admin/moderation" },
        { label: "Signalements" },
      ]}
      subtitle={`${totalGroups} cible${totalGroups !== 1 ? "s" : ""} · ${totalReports} signalement${totalReports !== 1 ? "s" : ""}`}
      actions={
        <AdminButton
          size="sm"
          variant="secondary"
          onClick={() => void fetchGroups()}
          loading={loading}
        >
          Rafraîchir
        </AdminButton>
      }
    >
      {/* Filters */}
      <AdminCard variant="compact" className="mb-4">
        <div className="space-y-3">
          <div>
            <p className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
              Statut
            </p>
            <AdminFilterChips
              chips={STATUS_CHIPS}
              value={status}
              onChange={(v) => v && setStatus(v)}
              allowDeselect={false}
            />
          </div>
          <div>
            <p className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
              Type de cible
            </p>
            <AdminFilterChips
              chips={TARGET_CHIPS}
              value={targetType}
              onChange={(v) => v && setTargetType(v)}
              allowDeselect={false}
            />
          </div>
          <div>
            <p className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
              Raison
            </p>
            <AdminFilterChips
              chips={REASON_CHIPS}
              value={reason}
              onChange={(v) => v && setReason(v)}
              allowDeselect={false}
            />
          </div>
        </div>
      </AdminCard>

      {/* List */}
      {loading ? (
        <p className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-8 text-center text-sm text-[var(--text-muted)]">
          Chargement…
        </p>
      ) : filteredGroups.length === 0 ? (
        <AdminEmptyState
          icon="✓"
          title={
            status === "pending"
              ? "Aucun signalement en attente"
              : `Aucun signalement ${STATUS_CHIPS.find((s) => s.id === status)?.label.toLowerCase()}`
          }
          body={
            groups.length > 0 && filteredGroups.length === 0
              ? "Aucun signalement ne correspond à ces filtres. Essaye d'élargir."
              : "La communauté est calme. C'est bien."
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredGroups.map((g) => (
            <ReportTriageCard
              key={`${g.target_type}:${g.target_id}`}
              group={g}
              busy={busyTarget === `${g.target_type}:${g.target_id}`}
              onHide={() => void hideTarget(g)}
              onDismiss={() => void dismissReports(g)}
            />
          ))}
        </div>
      )}
    </AdminPage>
  );
}
