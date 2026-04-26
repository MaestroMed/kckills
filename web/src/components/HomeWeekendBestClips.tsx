/**
 * HomeWeekendBestClips — section homepage sous le hero.
 *
 * "Les meilleurs clips de ce week-end" — surface les clips publiés sur
 * la fenêtre vendredi-dimanche en cours (ou le dernier week-end joué
 * si on est en milieu de semaine).
 *
 * Tri intelligent :
 *   1. Score IA (highlight_score) DESC — le worker Gemini sait ce qui
 *      est cinématique
 *   2. Communauté (avg_rating × log(rating_count)) — pondère le buzz
 *   3. Multi-kill bonus — penta > quadra > triple (même score brut)
 *
 * Layout :
 *   * Mobile : 2 cards / row, snap-x scroll horizontal pour parcourir
 *     les 12 picks sans scroll vertical
 *   * Desktop : grille 4 cols, 12 cards visibles d'un coup
 *
 * État vide : si aucun clip n'a été publié sur le week-end (ex. pas
 * de match ce week-end OU le worker n'a pas encore process), on
 * affiche un placeholder « Bientôt — les clips arrivent dès la fin
 * du match ». On ne rend PAS la section au DOM si l'état vide est
 * une indisponibilité totale (zéro clip publié quel que soit l'âge).
 */

import Link from "next/link";
import Image from "next/image";
import { getWeekendBestClips, type PublishedKillRow } from "@/lib/supabase/kills";
import { pickAssetUrl, getAssetMetadata } from "@/lib/kill-assets";

/**
 * Compute the current "weekend window" — Friday 00:00 → Monday 06:00 UTC.
 * If we're Tuesday-Thursday, return the LAST completed weekend so the
 * section keeps showing fresh content mid-week (LEC plays Fri/Sat/Sun
 * primarily — Mon-Thu is content drought).
 */
function currentWeekendWindow(now: Date = new Date()): { from: Date; to: Date; label: string } {
  const day = now.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // If Friday/Saturday/Sunday/Monday → "this weekend" (live or just ended)
  // If Tuesday-Thursday → "last weekend" (mid-week, surface freshest)
  let fridayOffset: number;
  if (day === 5) fridayOffset = 0;          // today is Friday → this weekend
  else if (day === 6) fridayOffset = -1;    // Saturday
  else if (day === 0) fridayOffset = -2;    // Sunday
  else if (day === 1) fridayOffset = -3;    // Monday → still showing the just-ended weekend
  else fridayOffset = -((day + 2) % 7);     // Tue/Wed/Thu → last Friday

  const friday = new Date(todayUtc);
  friday.setUTCDate(friday.getUTCDate() + fridayOffset);
  const monday6h = new Date(friday);
  monday6h.setUTCDate(monday6h.getUTCDate() + 3);
  monday6h.setUTCHours(6, 0, 0, 0); // Monday 06:00 UTC = end of weekend window

  // Format the user-facing date range
  const fmt = (d: Date) =>
    d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
  const label = `${fmt(friday)} – ${fmt(new Date(monday6h.getTime() - 1))}`;

  return { from: friday, to: monday6h, label };
}

interface ClipCardProps {
  kill: PublishedKillRow;
  priority?: boolean;
  rank: number;
}

function ClipCard({ kill, priority = false, rank }: ClipCardProps) {
  const thumb = pickAssetUrl(kill, "thumbnail");
  const meta = getAssetMetadata(kill, "thumbnail");
  const score = kill.highlight_score ?? 0;
  const scoreClass =
    score >= 8.5
      ? "text-[var(--gold-bright)] bg-[var(--gold)]/30 border-[var(--gold)]"
      : score >= 7.0
        ? "text-[var(--gold)] bg-[var(--gold)]/15 border-[var(--gold)]/50"
        : "text-[var(--text-secondary)] bg-white/5 border-white/15";

  const multiKillLabel = kill.multi_kill ? kill.multi_kill.toUpperCase() : null;
  const showFirstBlood = kill.is_first_blood;

  const matchupLabel =
    kill.killer_champion && kill.victim_champion
      ? `${kill.killer_champion} → ${kill.victim_champion}`
      : kill.killer_champion ?? "Clip KC";

  return (
    <Link
      href={`/scroll?kill=${kill.id}`}
      aria-label={`Lire le clip : ${matchupLabel}`}
      className="group relative shrink-0 snap-start w-[78vw] max-w-[260px] sm:w-auto sm:max-w-none overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-black transition-all hover:border-[var(--gold)]/60 hover:scale-[1.02] hover:-translate-y-1 hover:shadow-2xl hover:shadow-[var(--gold)]/20"
      style={{ aspectRatio: "9 / 16" }}
    >
      {thumb ? (
        <Image
          src={thumb}
          alt={`Clip ${matchupLabel}`}
          fill
          sizes="(max-width: 640px) 78vw, (max-width: 1024px) 30vw, 22vw"
          className="object-cover transition-transform duration-700 group-hover:scale-110"
          priority={priority}
          {...(meta?.width && meta.height ? { width: meta.width, height: meta.height } : {})}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]">
          <span className="font-display text-3xl text-[var(--gold-dark)]">KC</span>
        </div>
      )}

      {/* Top-left rank chip */}
      <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5">
        <span className="rounded-md bg-black/70 backdrop-blur px-1.5 py-0.5 font-data text-[10px] font-bold tracking-[0.18em] text-[var(--gold-bright)]">
          #{rank}
        </span>
        {showFirstBlood && (
          <span
            aria-label="First blood"
            className="rounded-md bg-[var(--red)]/85 backdrop-blur px-1.5 py-0.5 font-data text-[9px] font-bold uppercase tracking-widest text-white"
          >
            1st blood
          </span>
        )}
      </div>

      {/* Top-right score chip */}
      <div className="absolute right-2 top-2 z-10">
        <span
          className={`rounded-md backdrop-blur px-1.5 py-0.5 font-data text-[10px] font-bold border ${scoreClass}`}
          aria-label={`Score IA : ${score.toFixed(1)} sur 10`}
        >
          {score.toFixed(1)}
        </span>
      </div>

      {/* Multi-kill badge centered top */}
      {multiKillLabel && (
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 z-10">
          <span className="rounded-full border border-[var(--gold-bright)]/50 bg-black/70 backdrop-blur px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.2em] text-[var(--gold-bright)]">
            {multiKillLabel}
          </span>
        </div>
      )}

      {/* Bottom gradient + champion text */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] bg-gradient-to-t from-black/95 via-black/60 to-transparent p-3 pt-10">
        <p className="font-display text-sm text-[var(--gold-bright)] line-clamp-1 drop-shadow-md">
          {matchupLabel}
        </p>
        {kill.ai_description && (
          <p className="mt-0.5 text-[11px] text-[var(--text-secondary)] line-clamp-2 leading-snug">
            {kill.ai_description}
          </p>
        )}
        {(kill.avg_rating ?? 0) > 0 && (
          <p className="mt-1 font-data text-[10px] text-[var(--gold)]/80">
            ★ {(kill.avg_rating ?? 0).toFixed(1)}
            <span className="text-[var(--text-disabled)]"> · {kill.rating_count ?? 0} votes</span>
          </p>
        )}
      </div>
    </Link>
  );
}

export async function HomeWeekendBestClips() {
  const { from, to, label } = currentWeekendWindow();
  const clips = await getWeekendBestClips({
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    limit: 12,
  });

  // Don't render the section at all if NO clips exist anywhere in the system
  // (would mean the worker hasn't run yet — section would be permanent empty).
  // The loader returns a fallback to recent published kills if the weekend window is empty,
  // so empty here means TRULY empty.
  if (clips.length === 0) {
    return null;
  }

  const isEmptyWindow = clips.every((k) => {
    const created = k.created_at ? new Date(k.created_at) : null;
    return created ? created < from || created >= to : true;
  });

  return (
    <section
      aria-labelledby="weekend-best-clips-heading"
      className="relative max-w-7xl mx-auto px-4 md:px-6 pt-8 pb-2"
    >
      {/* ─── Header band ──────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <p className="font-data text-[10px] sm:text-[11px] uppercase tracking-[0.3em] text-[var(--gold)]/70">
            🔥 Le top du week-end
          </p>
          <h2
            id="weekend-best-clips-heading"
            className="mt-1 font-display text-2xl sm:text-3xl text-[var(--gold-bright)] leading-tight"
          >
            Les meilleurs clips de ce week-end
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {label}
            {isEmptyWindow && (
              <span className="ml-1.5 text-[var(--text-disabled)]">
                · derniers clips disponibles
              </span>
            )}
          </p>
        </div>
        <Link
          href="/scroll"
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/5 hover:bg-[var(--gold)]/15 hover:border-[var(--gold)] font-data text-[11px] uppercase tracking-widest text-[var(--gold-bright)] transition-all"
        >
          Voir tous les clips
          <span className="text-base leading-none">→</span>
        </Link>
      </div>

      {/* ─── Cards ────────────────────────────────────────────────── */}
      {/* Mobile: snap-x horizontal scroll. Desktop: 4-col grid. */}
      <div
        className="
          flex gap-3 overflow-x-auto pb-3 -mx-4 px-4
          snap-x snap-mandatory scroll-smooth
          [scrollbar-width:none] [-ms-overflow-style:none]
          [&::-webkit-scrollbar]:hidden
          sm:overflow-visible sm:mx-0 sm:px-0 sm:pb-0 sm:grid sm:grid-cols-3 lg:grid-cols-4
        "
      >
        {clips.map((kill, idx) => (
          <ClipCard key={kill.id} kill={kill} rank={idx + 1} priority={idx < 4} />
        ))}
      </div>

      {/* ─── Mobile-only "voir tout" footer ────────────────────────── */}
      <div className="mt-4 sm:hidden text-center">
        <Link
          href="/scroll"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/5 hover:bg-[var(--gold)]/15 font-data text-xs uppercase tracking-widest text-[var(--gold-bright)] transition-all"
        >
          Voir tous les clips →
        </Link>
      </div>
    </section>
  );
}
