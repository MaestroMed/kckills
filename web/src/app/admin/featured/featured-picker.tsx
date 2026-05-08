"use client";

/**
 * Featured picker — pin one kill per day to the homepage hero
 * (PR-loltok ED).
 *
 * Migrated to Agent EA's primitives + new <FeaturedCalendar /> month
 * grid (Agent ED). The picker modal lives in this file and consumes
 * the existing PUT /api/admin/featured/[date] endpoint.
 *
 * The optional "this hour" / "weekend" override at the top uses the
 * editorial.feature endpoint (range-based pin via /api/admin/editorial/
 * feature) — same surface the EditorialCard uses.
 */

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { AdminBadge } from "@/components/admin/ui/AdminBadge";
import { AdminBreadcrumbs } from "@/components/admin/ui/AdminBreadcrumbs";
import { AdminButton } from "@/components/admin/ui/AdminButton";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { AdminEmptyState } from "@/components/admin/ui/AdminEmptyState";
import { AdminSection } from "@/components/admin/ui/AdminSection";
import {
  FeaturedCalendar,
  type FeaturedCalendarKill,
  type FeaturedCalendarPin,
} from "@/components/admin/featured/FeaturedCalendar";
import { setFeaturedKill, removeFeaturedKill } from "./actions";

interface KillLite {
  id: string;
  killerChampion: string;
  victimChampion: string;
  thumbnail: string | null;
  highlightScore: number | null;
  aiDescription: string | null;
  fightType: string | null;
  gameDate: string | null;
}

interface FeaturedRow {
  date: string;
  notes: string | null;
  setAt: string;
  setBy: string | null;
  kill: KillLite | null;
}

interface ToastMsg {
  id: number;
  text: string;
  tone: "success" | "error" | "info";
}

export function FeaturedPicker({
  featured,
  topKills,
}: {
  featured: FeaturedRow[];
  topKills: KillLite[];
}) {
  const [pickerForDate, setPickerForDate] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [, startTransition] = useTransition();

  const pushToast = (text: string, tone: ToastMsg["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2800);
  };

  const pins: FeaturedCalendarPin[] = useMemo(
    () =>
      featured
        .filter((f) => f.kill)
        .map((f) => ({
          date: f.date,
          killId: f.kill!.id,
          notes: f.notes,
        })),
    [featured],
  );

  const killsById = useMemo(() => {
    const m = new Map<string, FeaturedCalendarKill>();
    for (const f of featured) {
      if (f.kill) {
        m.set(f.kill.id, {
          id: f.kill.id,
          killerChampion: f.kill.killerChampion,
          victimChampion: f.kill.victimChampion,
          thumbnail: f.kill.thumbnail,
          highlightScore: f.kill.highlightScore,
        });
      }
    }
    for (const k of topKills) {
      if (!m.has(k.id)) {
        m.set(k.id, {
          id: k.id,
          killerChampion: k.killerChampion,
          victimChampion: k.victimChampion,
          thumbnail: k.thumbnail,
          highlightScore: k.highlightScore,
        });
      }
    }
    return m;
  }, [featured, topKills]);

  const setFeatured = (date: string, killId: string) => {
    setSaving(true);
    startTransition(async () => {
      try {
        const result = await setFeaturedKill(date, killId);
        if (result.ok) {
          pushToast(`Pin du ${date} enregistré.`);
          setPickerForDate(null);
          // revalidatePath in the action triggers an RSC refresh ; reload
          // until the parent page picks it up via router.refresh().
          window.location.reload();
        } else {
          pushToast(`Erreur : ${result.error ?? "Erreur inconnue"}`, "error");
        }
      } catch (e) {
        pushToast(e instanceof Error ? e.message : "Erreur action", "error");
      } finally {
        setSaving(false);
      }
    });
  };

  const removeFeatured = (date: string) => {
    startTransition(async () => {
      try {
        const result = await removeFeaturedKill(date);
        if (result.ok) {
          pushToast(`Pin du ${date} supprimé.`);
          window.location.reload();
        } else {
          pushToast(`Erreur : ${result.error ?? "suppression"}`, "error");
        }
      } catch (e) {
        pushToast(e instanceof Error ? e.message : "Erreur action", "error");
      }
    });
  };

  const rangePin = async (windowKind: "hour" | "weekend") => {
    // Picks the highest-score top kill not already pinned today, then pins
    // it for the requested window via /api/admin/editorial/feature.
    const candidate = topKills.find((k) => !!k);
    if (!candidate) {
      pushToast("Aucun kill candidat dans le top.", "error");
      return;
    }
    const now = new Date();
    let from: Date;
    let to: Date;
    if (windowKind === "hour") {
      from = new Date(now);
      from.setMinutes(0, 0, 0);
      to = new Date(from.getTime() + 3600 * 1000);
    } else {
      // Next Saturday 00:00 → Sunday 23:59 UTC.
      from = new Date(now);
      const dow = from.getDay(); // Sun=0
      const daysUntilSat = (6 - dow + 7) % 7 || 7;
      from.setUTCDate(from.getUTCDate() + daysUntilSat);
      from.setUTCHours(0, 0, 0, 0);
      to = new Date(from.getTime() + 2 * 24 * 3600 * 1000 - 1000);
    }
    const label =
      windowKind === "hour"
        ? `cette heure (${from.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })})`
        : `le weekend prochain (${from.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })})`;
    if (!confirm(`Pin « ${candidate.killerChampion} → ${candidate.victimChampion} » pour ${label} ?`)) {
      return;
    }
    try {
      const r = await fetch("/api/admin/editorial/feature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kill_id: candidate.id,
          valid_from: from.toISOString(),
          valid_to: to.toISOString(),
          custom_note: `Auto-pin ${windowKind}`,
        }),
      });
      if (r.ok) pushToast("Pin enregistré.");
      else {
        const e = await r.json().catch(() => ({}));
        pushToast(`Erreur : ${e.error ?? `HTTP ${r.status}`}`, "error");
      }
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Erreur réseau", "error");
    }
  };

  const filteredKills = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return topKills;
    return topKills.filter(
      (k) =>
        k.killerChampion.toLowerCase().includes(q) ||
        k.victimChampion.toLowerCase().includes(q) ||
        (k.aiDescription ?? "").toLowerCase().includes(q),
    );
  }, [pickerSearch, topKills]);

  const pinnedToday = useMemo(() => {
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return featured.find((f) => f.date === key) ?? null;
  }, [featured]);

  return (
    <div className="space-y-5">
      <AdminBreadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Featured du jour" }]} />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black text-[var(--gold)]">
            Featured Clip du Jour
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Pinne un clip par jour à la une. Cliquez sur une case du calendrier pour ouvrir le picker.
          </p>
        </div>
        {pinnedToday?.kill && (
          <AdminBadge variant="success" size="md">
            Aujourd&apos;hui : {pinnedToday.kill.killerChampion} → {pinnedToday.kill.victimChampion}
          </AdminBadge>
        )}
      </header>

      <AdminSection
        title="Pin éclair"
        subtitle="Override temporel via /editorial/feature (range-based)."
        action={
          <div className="flex gap-1.5">
            <AdminButton variant="secondary" size="sm" onClick={() => rangePin("hour")}>
              Cette heure
            </AdminButton>
            <AdminButton variant="secondary" size="sm" onClick={() => rangePin("weekend")}>
              Le weekend
            </AdminButton>
          </div>
        }
        dense
      >
        <p className="text-[10px] text-[var(--text-muted)]">
          Pinne le top kill (score le plus élevé) pour la plage choisie sans toucher
          au calendrier journalier.
        </p>
      </AdminSection>

      <AdminSection title="Calendrier" subtitle={`${pins.length} pin(s) actif(s)`}>
        <AdminCard variant="default">
          <FeaturedCalendar
            pins={pins}
            killsById={killsById}
            onPickDate={(date) => setPickerForDate(date)}
            onRemovePin={(date) => removeFeatured(date)}
          />
        </AdminCard>
      </AdminSection>

      {pickerForDate && (
        <PickerModal
          date={pickerForDate}
          search={pickerSearch}
          onSearchChange={setPickerSearch}
          kills={filteredKills}
          totalKills={topKills.length}
          saving={saving}
          onPick={(killId) => setFeatured(pickerForDate, killId)}
          onClose={() => setPickerForDate(null)}
        />
      )}

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

function PickerModal({
  date,
  search,
  onSearchChange,
  kills,
  totalKills,
  saving,
  onPick,
  onClose,
}: {
  date: string;
  search: string;
  onSearchChange: (s: string) => void;
  kills: KillLite[];
  totalKills: number;
  saving: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[80vh] flex flex-col rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b border-[var(--border-gold)]">
          <div>
            <h2 className="font-display text-lg font-black text-[var(--gold)]">
              Choisir un clip pour le {date}
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              {totalKills} clip(s) score ≥ 7 disponibles
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-2xl text-[var(--text-muted)] hover:text-[var(--gold)]"
            aria-label="Fermer"
          >
            ×
          </button>
        </header>

        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Filtrer par champion, description…"
          className="m-4 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
        />

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {kills.length === 0 ? (
            <AdminEmptyState
              icon="◎"
              title="Aucun clip ne correspond"
              body="Affine la recherche."
              compact
            />
          ) : (
            kills.map((k) => (
              <button
                key={k.id}
                onClick={() => onPick(k.id)}
                disabled={saving}
                className="w-full flex items-center gap-3 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] p-2 hover:border-[var(--gold)]/60 disabled:opacity-50 transition-all text-left"
              >
                {k.thumbnail && (
                  <div className="relative h-12 w-20 flex-shrink-0 overflow-hidden rounded bg-black">
                    <Image src={k.thumbnail} alt="" fill sizes="80px" className="object-cover" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">
                    {k.killerChampion} → {k.victimChampion}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {k.aiDescription?.slice(0, 80) ?? "—"}
                  </p>
                </div>
                <span className="font-mono text-[var(--gold)]">
                  {k.highlightScore?.toFixed(1)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
