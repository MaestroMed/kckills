"use client";

import { useState } from "react";
import Image from "next/image";

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

export function FeaturedPicker({
  featured,
  topKills,
}: {
  featured: FeaturedRow[];
  topKills: KillLite[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [pickerForDate, setPickerForDate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");

  // Build calendar: last 14 days + today + next 7
  const calendar: { date: string; isPast: boolean; isToday: boolean; row: FeaturedRow | null }[] = [];
  for (let i = -14; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const row = featured.find((f) => f.date === dateStr) ?? null;
    calendar.push({ date: dateStr, isPast: i < 0, isToday: i === 0, row });
  }

  const setFeatured = async (date: string, killId: string) => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/featured/${date}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kill_id: killId }),
      });
      if (r.ok) {
        setPickerForDate(null);
        window.location.reload();
      } else {
        const data = await r.json();
        setError(data.error ?? "Erreur");
      }
    } finally {
      setSaving(false);
    }
  };

  const removeFeatured = async (date: string) => {
    if (!confirm(`Retirer le featured du ${date} ?`)) return;
    await fetch(`/api/admin/featured/${date}`, { method: "DELETE" });
    window.location.reload();
  };

  const filteredKills = pickerSearch.trim()
    ? topKills.filter(
        (k) =>
          k.killerChampion.toLowerCase().includes(pickerSearch.toLowerCase()) ||
          k.victimChampion.toLowerCase().includes(pickerSearch.toLowerCase()),
      )
    : topKills;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-black text-[var(--gold)]">Featured Clip du Jour</h1>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Clip vedette affiché sur la homepage. Pick un par jour.
        </p>
      </header>

      {/* Calendar strip */}
      <section>
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-3">
          Calendrier
        </h2>
        <div className="space-y-2">
          {calendar.reverse().map(({ date, isPast, isToday, row }) => (
            <div
              key={date}
              className={`flex items-center gap-3 rounded-xl border p-3 ${
                isToday
                  ? "border-[var(--gold)] bg-[var(--gold)]/5"
                  : isPast
                    ? "border-[var(--border-gold)]/50 bg-[var(--bg-surface)]/50 opacity-60"
                    : "border-[var(--border-gold)] bg-[var(--bg-surface)]"
              }`}
            >
              <div className="w-24 flex-shrink-0">
                <p className={`font-data text-xs font-bold ${isToday ? "text-[var(--gold)]" : "text-[var(--text-muted)]"}`}>
                  {new Date(date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
                </p>
                {isToday && <p className="text-[9px] uppercase tracking-widest text-[var(--gold)]">Aujourd&apos;hui</p>}
              </div>

              {row?.kill ? (
                <>
                  {row.kill.thumbnail && (
                    <div className="relative h-12 w-20 flex-shrink-0 overflow-hidden rounded-md bg-black">
                      <Image src={row.kill.thumbnail} alt="" fill sizes="80px" className="object-cover" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[var(--text-primary)]">
                      {row.kill.killerChampion} → {row.kill.victimChampion}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] truncate">
                      {row.kill.aiDescription?.slice(0, 80) ?? "—"}
                    </p>
                  </div>
                  <span className="font-data text-[var(--gold)] text-sm">
                    {row.kill.highlightScore?.toFixed(1)}
                  </span>
                  <button
                    onClick={() => setPickerForDate(date)}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--gold)] px-2"
                  >
                    Changer
                  </button>
                  <button
                    onClick={() => removeFeatured(date)}
                    className="text-xs text-[var(--red)] hover:opacity-80 px-2"
                  >
                    ×
                  </button>
                </>
              ) : (
                <>
                  <p className="flex-1 text-xs text-[var(--text-muted)]">Aucun featured</p>
                  <button
                    onClick={() => setPickerForDate(date)}
                    disabled={isPast}
                    className="text-xs rounded-md border border-[var(--gold)]/30 px-3 py-1 text-[var(--gold)] hover:bg-[var(--gold)]/10 disabled:opacity-30"
                  >
                    Pick
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Picker modal */}
      {pickerForDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setPickerForDate(null)}>
          <div
            className="w-full max-w-3xl max-h-[80vh] flex flex-col rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between p-4 border-b border-[var(--border-gold)]">
              <div>
                <h2 className="font-display text-lg font-black text-[var(--gold)]">
                  Choisir un clip pour le {pickerForDate === today ? "aujourd'hui" : pickerForDate}
                </h2>
                <p className="text-xs text-[var(--text-muted)]">{topKills.length} clips score ≥ 7</p>
              </div>
              <button onClick={() => setPickerForDate(null)} className="text-2xl text-[var(--text-muted)] hover:text-[var(--gold)]">×</button>
            </header>

            <input
              type="text"
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              placeholder="Filtrer par champion..."
              className="m-4 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
            />

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {filteredKills.map((k) => (
                <button
                  key={k.id}
                  onClick={() => setFeatured(pickerForDate, k.id)}
                  disabled={saving}
                  className="w-full flex items-center gap-3 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] p-2 hover:border-[var(--gold)]/60 disabled:opacity-50 transition-all"
                >
                  {k.thumbnail && (
                    <div className="relative h-12 w-20 flex-shrink-0 overflow-hidden rounded bg-black">
                      <Image src={k.thumbnail} alt="" fill sizes="80px" className="object-cover" />
                    </div>
                  )}
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-sm font-bold">{k.killerChampion} → {k.victimChampion}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate">
                      {k.aiDescription?.slice(0, 60) ?? "—"}
                    </p>
                  </div>
                  <span className="font-data text-[var(--gold)]">{k.highlightScore?.toFixed(1)}</span>
                </button>
              ))}
            </div>

            {error && <p className="p-3 text-xs text-[var(--red)]">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
