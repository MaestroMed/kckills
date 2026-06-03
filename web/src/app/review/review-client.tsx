"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useT, type TranslateFn } from "@/lib/i18n/use-lang";

interface ReviewItem {
  id: string;
  killerChampion: string;
  victimChampion: string;
  clipHorizontal: string | null;
  clipVertical: string | null;
  thumbnail: string | null;
  aiDescription: string | null;
  aiTags: string[];
  highlightScore: number | null;
  multiKill: string | null;
  isFirstBlood: boolean;
  kcInvolvement: string | null;
  gameTimeSeconds: number;
  gameNumber: number;
  matchStage: string;
}

interface Review {
  killId: string;
  timing: number;       // 1-5: le clip montre-t-il le bon moment ?
  action: number;       // 1-5: voit-on clairement le kill ?
  description: number;  // 1-5: la description est-elle exacte ?
  quality: number;      // 1-5: qualité vidéo (résolution, fluidité)
  hype: number;         // 1-5: le clip donne-t-il envie de le partager ?
  notes: string;
}

const CRITERIA = [
  { key: "timing" },
  { key: "action" },
  { key: "description" },
  { key: "quality" },
  { key: "hype" },
] as const;

/** Resolve the localized label for a review criterion key. */
function criterionLabel(t: TranslateFn, key: string): string {
  return t(`p_pubpages.review_criteria_${key}_label`);
}

/** Resolve the localized description for a review criterion key. */
function criterionDesc(t: TranslateFn, key: string): string {
  return t(`p_pubpages.review_criteria_${key}_desc`);
}

export function ReviewClient({ items }: { items: ReviewItem[] }) {
  const t = useT();
  const [currentIdx, setCurrentIdx] = useState(0);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");

  const current = items[currentIdx];
  const total = items.length;
  const reviewed = reviews.length;
  const progress = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  const submitReview = useCallback(() => {
    if (!current) return;
    const review: Review = {
      killId: current.id,
      timing: scores.timing || 3,
      action: scores.action || 3,
      description: scores.description || 3,
      quality: scores.quality || 3,
      hype: scores.hype || 3,
      notes,
    };
    setReviews((prev) => [...prev, review]);
    setScores({});
    setNotes("");
    if (currentIdx < total - 1) {
      setCurrentIdx((i) => i + 1);
    }
  }, [current, scores, notes, currentIdx, total]);

  const skip = useCallback(() => {
    if (currentIdx < total - 1) {
      setCurrentIdx((i) => i + 1);
      setScores({});
      setNotes("");
    }
  }, [currentIdx, total]);

  // Average scores across all reviews
  const avgScores = reviews.length > 0
    ? CRITERIA.map((c) => ({
        key: c.key,
        label: criterionLabel(t, c.key),
        avg: +(reviews.reduce((a, r) => a + (r as unknown as Record<string, number>)[c.key], 0) / reviews.length).toFixed(1),
      }))
    : [];
  const globalAvg = avgScores.length > 0
    ? +(avgScores.reduce((a, s) => a + s.avg, 0) / avgScores.length).toFixed(1)
    : 0;

  if (!current) {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center">
        <h1 className="font-display text-3xl font-bold text-[var(--gold)]">{t("p_pubpages.review_done_title")}</h1>
        <p className="mt-4 text-[var(--text-muted)]">{t("p_pubpages.review_n_rated", { n: reviewed })}</p>
        {avgScores.length > 0 && <ScoreSummary scores={avgScores} global={globalAvg} t={t} />}
        <ExportButton reviews={reviews} label={t("p_pubpages.review_export_button")} />
      </div>
    );
  }

  const gt = current.gameTimeSeconds;
  const gtStr = `${Math.floor(gt / 60).toString().padStart(2, "0")}:${(gt % 60).toString().padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-5xl py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-[var(--text-muted)] hover:text-[var(--gold)]">
          {t("p_pubpages.review_back_to_site")}
        </Link>
        <div className="text-right">
          <p className="font-data text-sm text-[var(--gold)]">
            {currentIdx + 1} / {total}
          </p>
          <div className="w-48 h-1.5 rounded-full bg-[var(--bg-elevated)] mt-1">
            <div
              className="h-full rounded-full bg-[var(--gold)] transition-all"
              style={{ width: `${((currentIdx + 1) / total) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Video player */}
      <div className="rounded-2xl border border-[var(--border-gold)] bg-black overflow-hidden">
        <video
          key={current.id}
          className="w-full aspect-video"
          src={current.clipHorizontal ?? current.clipVertical ?? undefined}
          poster={current.thumbnail ?? undefined}
          controls
          autoPlay
          playsInline
          preload="auto"
        />
      </div>

      {/* Kill context */}
      <div className="flex items-center justify-between rounded-xl bg-[var(--bg-surface)] border border-[var(--border-gold)] p-4">
        <div>
          <p className="font-display text-lg font-bold">
            <span className={current.kcInvolvement === "team_killer" ? "text-[var(--gold)]" : "text-white"}>
              {current.killerChampion}
            </span>
            <span className="text-[var(--text-muted)] mx-2">&rarr;</span>
            <span className="text-white/80">{current.victimChampion}</span>
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            {current.matchStage} &middot; {t("p_pubpages.review_game_n", { n: current.gameNumber })} &middot; T+{gtStr}
            {current.multiKill && <span className="ml-2 text-[var(--orange)]">{t("p_pubpages.review_multikill_suffix", { kind: current.multiKill })}</span>}
            {current.isFirstBlood && <span className="ml-2 text-[var(--red)]">{t("p_pubpages.review_first_blood")}</span>}
          </p>
        </div>
        {current.highlightScore != null && (
          <span className="font-data text-2xl font-bold text-[var(--gold)]">
            {current.highlightScore.toFixed(1)}/10
          </span>
        )}
      </div>

      {/* AI description under review */}
      {current.aiDescription && (
        <div className="rounded-xl border-l-2 border-[var(--gold)]/40 bg-[var(--bg-surface)] px-5 py-3">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-1">{t("p_pubpages.review_ai_description")}</p>
          <p className="text-sm italic text-white/90">
            &laquo; {current.aiDescription} &raquo;
          </p>
          {current.aiTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {current.aiTags.map((tag) => (
                <span key={tag} className="rounded-full bg-[var(--gold)]/10 border border-[var(--gold)]/20 px-2 py-0.5 text-[9px] text-[var(--gold)]">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Rating grid */}
      <div className="grid gap-3 md:grid-cols-5">
        {CRITERIA.map((c) => (
          <div key={c.key} className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 text-center">
            <p className="font-display text-xs font-bold mb-1">{criterionLabel(t, c.key)}</p>
            <p className="text-[9px] text-[var(--text-muted)] mb-3">{criterionDesc(t, c.key)}</p>
            <div className="flex justify-center gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => setScores((prev) => ({ ...prev, [c.key]: s }))}
                  className={`h-9 w-9 rounded-lg border text-sm font-bold transition-all ${
                    (scores[c.key] ?? 0) >= s
                      ? "bg-[var(--gold)]/30 border-[var(--gold)] text-[var(--gold)]"
                      : "bg-[var(--bg-primary)] border-[var(--border-gold)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Notes */}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={t("p_pubpages.review_notes_placeholder")}
        className="w-full rounded-xl border border-[var(--border-gold)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none focus:border-[var(--gold)] resize-none h-20"
      />

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={submitReview}
          className="flex-1 rounded-xl bg-[var(--gold)] py-3 font-display text-sm font-bold text-black uppercase tracking-widest hover:bg-[var(--gold-bright)] transition-colors"
        >
          {t("p_pubpages.review_validate_next")}
        </button>
        <button
          onClick={skip}
          className="rounded-xl border border-[var(--border-gold)] px-6 py-3 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] transition-colors"
        >
          {t("p_pubpages.review_skip")}
        </button>
      </div>

      {/* Live summary if reviews exist */}
      {avgScores.length > 0 && (
        <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-2">
            {t("p_pubpages.review_avg_over", { n: reviewed })}
          </p>
          <div className="flex justify-between">
            {avgScores.map((s) => (
              <div key={s.key} className="text-center">
                <p className="font-data text-lg font-bold text-[var(--gold)]">{s.avg}</p>
                <p className="text-[9px] text-[var(--text-muted)]">{s.label}</p>
              </div>
            ))}
            <div className="text-center border-l border-[var(--border-gold)] pl-4">
              <p className="font-data text-lg font-bold text-[var(--cyan)]">{globalAvg}</p>
              <p className="text-[9px] text-[var(--text-muted)]">{t("p_pubpages.review_global")}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreSummary({ scores, global, t }: { scores: { key: string; label: string; avg: number }[]; global: number; t: TranslateFn }) {
  return (
    <div className="mt-8 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6">
      <h2 className="font-display text-lg font-bold mb-4">{t("p_pubpages.review_qa_result")}</h2>
      <div className="grid grid-cols-5 gap-4 mb-4">
        {scores.map((s) => (
          <div key={s.key} className="text-center">
            <p className={`font-data text-2xl font-bold ${s.avg >= 4 ? "text-[var(--green)]" : s.avg >= 3 ? "text-[var(--gold)]" : "text-[var(--red)]"}`}>
              {s.avg}
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">{s.label}</p>
          </div>
        ))}
      </div>
      <div className="text-center border-t border-[var(--border-gold)] pt-4">
        <p className={`font-data text-4xl font-bold ${global >= 4 ? "text-[var(--green)]" : global >= 3 ? "text-[var(--gold)]" : "text-[var(--red)]"}`}>
          {global}/5
        </p>
        <p className="text-sm text-[var(--text-muted)]">{t("p_pubpages.review_global_quality")}</p>
      </div>
    </div>
  );
}

function ExportButton({ reviews, label }: { reviews: Review[]; label: string }) {
  return (
    <button
      onClick={() => {
        const blob = new Blob([JSON.stringify(reviews, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `clip-qa-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }}
      className="mt-6 inline-flex items-center gap-2 rounded-xl border border-[var(--gold)]/30 bg-[var(--gold)]/10 px-6 py-3 text-sm font-bold text-[var(--gold)] hover:bg-[var(--gold)]/20 transition-colors"
    >
      {label}
    </button>
  );
}
