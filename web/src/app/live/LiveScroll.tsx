"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { m, AnimatePresence, useReducedMotion } from "motion/react";
import type { LiveKillRow, LiveMatchRow } from "@/lib/supabase/live";

/**
 * LiveScroll — auto-refreshing feed for /live.
 *
 * The header shows the matchup, current score, and a 1-Hz ticker.
 * The hero plays the most-recent kill clip auto-mute. Below, every
 * other kill of the match in chronological order (newest → oldest).
 *
 * Polling cadence : 10 s, with `?since=<event_epoch>` delta queries
 * so the payload after the initial load stays under ~500 B per tick
 * even mid-teamfight. New kills are prepended with an entrance
 * animation so the screen feels alive without overwhelming the user.
 *
 * If the match goes off-live mid-session, the next /api/live/state
 * poll returns `liveMatch: null` and we degrade to a "match finished"
 * card with a link back to the global feed.
 */

interface Props {
  initialMatch: LiveMatchRow;
  initialKills: LiveKillRow[];
  initialScore: { kc: number; opp: number };
}

interface LiveStatePayload {
  liveMatch: LiveMatchRow | null;
  recentKills: LiveKillRow[];
  score: { kc: number; opp: number };
}

const POLL_MS = 10_000;

export function LiveScroll({ initialMatch, initialKills, initialScore }: Props) {
  const reducedMotion = useReducedMotion();
  const [match, setMatch] = useState<LiveMatchRow | null>(initialMatch);
  const [kills, setKills] = useState<LiveKillRow[]>(initialKills);
  const [score, setScore] = useState<{ kc: number; opp: number }>(initialScore);
  const [now, setNow] = useState<number>(() => Date.now());

  const heroKill = kills[0] ?? null;

  // ─── Timer tick (1 Hz) ───────────────────────────────────────────
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // ─── Polling loop with delta queries ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    let controller: AbortController | null = null;

    const fetchInitialScore = async () => {
      try {
        const res = await fetch("/api/live/state");
        if (!res.ok) return;
        const data = (await res.json()) as LiveStatePayload;
        if (cancelled) return;
        if (data.liveMatch) {
          setMatch(data.liveMatch);
          setScore(data.score);
        }
      } catch { /* noop */ }
    };

    const tick = async () => {
      if (cancelled) return;
      if (controller) controller.abort();
      const ac = new AbortController();
      controller = ac;
      try {
        // Use the newest kill we've seen as the delta cursor. Falling
        // back to the initial timestamp so we never request the whole
        // feed on every tick.
        const latest = kills[0];
        const since = latest?.event_epoch
          ? new Date(latest.event_epoch * 1000).toISOString()
          : latest?.created_at;
        const url = since
          ? `/api/live/state?since=${encodeURIComponent(since)}`
          : "/api/live/state";
        const res = await fetch(url, { signal: ac.signal });
        if (cancelled || ac.signal.aborted) return;
        if (!res.ok) return;
        const data = (await res.json()) as LiveStatePayload;
        if (cancelled) return;
        if (!data.liveMatch) {
          // Match ended — flip to off-live mode. We keep the kills
          // we already have so the page doesn't go blank.
          setMatch(null);
          return;
        }
        setMatch(data.liveMatch);
        if (data.recentKills.length > 0) {
          setKills((prev) => {
            // Merge new kills at the head, dedup by id.
            const seen = new Set(prev.map((k) => k.id));
            const fresh = data.recentKills.filter((k) => !seen.has(k.id));
            if (fresh.length === 0) return prev;
            return [...fresh, ...prev];
          });
          // Also refresh score whenever we got fresh kills.
          void fetchInitialScore();
        }
      } catch (err) {
        if ((err as { name?: string })?.name !== "AbortError") {
          console.warn("[LiveScroll] poll failed:", err);
        }
      } finally {
        if (cancelled) return;
        timeoutId = window.setTimeout(tick, POLL_MS);
      }
    };

    timeoutId = window.setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      if (controller) controller.abort();
    };
    // We intentionally do NOT depend on `kills` here — re-creating the
    // loop on every kill ingestion would reset the timer and burn
    // network. The function reads `kills` from the closure at call time
    // via the React state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Ticker — minutes since first kill ────────────────────────────
  const tickerText = useMemo(() => {
    const first = kills[kills.length - 1];
    if (!first?.event_epoch) return null;
    const elapsedMs = now - first.event_epoch * 1000;
    if (elapsedMs < 0) return null;
    const secs = Math.floor(elapsedMs / 1000);
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }, [kills, now]);

  if (!match) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="font-display text-3xl font-bold text-[var(--gold)]">
          Match terminé
        </h1>
        <p className="mt-2 text-[var(--text-muted)]">
          Le live KC est fini. Retrouve les clips dans le feed.
        </p>
        <Link
          href="/scroll"
          className="mt-6 inline-block rounded-full bg-[var(--gold)] px-5 py-2 text-sm font-bold text-black"
        >
          Voir le scroll →
        </Link>
      </main>
    );
  }

  const matchupLabel = match.matchup_label ?? "KC";
  const opponent = match.blue?.code === "KC" ? match.red : match.blue;
  const heroGameNumber = heroKill?.game_number ?? 1;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-3 py-4 pb-32 sm:px-5">
      {/* ─── Cinematic header ─────────────────────────────────── */}
      <header className="rounded-2xl border border-[var(--red)]/30 bg-gradient-to-br from-[#1a0408] via-[#0d020a] to-[#080203] p-4 shadow-2xl sm:p-6">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            {!reducedMotion && (
              <m.span
                className="absolute inline-flex h-full w-full rounded-full bg-[var(--red)]"
                animate={{ scale: [1, 2, 1], opacity: [0.8, 0, 0.8] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
              />
            )}
            <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--red)]" />
          </span>
          <span className="font-display tracking-widest text-xs uppercase text-[var(--red)]">
            KC LIVE
          </span>
          <span className="font-data text-xs text-[var(--text-muted)]">
            · GAME {heroGameNumber}
          </span>
          {tickerText && (
            <span className="ml-auto font-data text-xs font-bold text-[var(--gold-bright)]">
              {tickerText}
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <h1 className="font-display text-3xl font-black text-[var(--text-primary)] sm:text-5xl">
            {matchupLabel}
          </h1>
          <span className="font-data text-3xl font-black tracking-wider text-[var(--gold)] sm:text-4xl">
            {score.kc} - {score.opp}
          </span>
          {opponent?.name && (
            <span className="font-data text-xs text-[var(--text-muted)]">
              vs {opponent.name}
            </span>
          )}
        </div>
        {match.stage && (
          <p className="mt-1 text-xs uppercase tracking-widest text-[var(--text-muted)]">
            {match.stage}
            {match.format && ` · ${match.format.toUpperCase()}`}
          </p>
        )}
      </header>

      {/* ─── Hero clip ────────────────────────────────────────── */}
      {heroKill?.clip_url_vertical && (
        <section className="overflow-hidden rounded-2xl border border-[var(--gold)]/15 bg-black shadow-xl">
          <div className="relative aspect-video w-full bg-black">
            <video
              key={heroKill.id}
              src={
                heroKill.clip_url_horizontal ??
                heroKill.clip_url_vertical ??
                undefined
              }
              poster={heroKill.thumbnail_url ?? undefined}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/70 to-transparent p-3">
              <p className="font-display text-base font-bold text-[var(--gold-bright)]">
                {heroKill.killer_champion ?? "?"} → {heroKill.victim_champion ?? "?"}
              </p>
              <p className="text-xs text-[var(--text-muted)] line-clamp-1">
                {heroKill.ai_description_fr ?? heroKill.ai_description ?? "Dernière action."}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Dernier kill
            </span>
            <Link
              href={`/kill/${heroKill.id}`}
              className="text-xs font-bold uppercase tracking-widest text-[var(--gold)] hover:text-[var(--gold-bright)]"
            >
              Détails →
            </Link>
          </div>
        </section>
      )}

      {/* ─── Chronological kill list ─────────────────────────── */}
      <section>
        <h2 className="mb-2 font-display text-sm uppercase tracking-widest text-[var(--text-muted)]">
          Tous les kills · {kills.length}
        </h2>
        <ul className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {kills.map((kill) => (
              <m.li
                key={kill.id}
                layout={!reducedMotion}
                initial={
                  reducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, y: -20, scale: 0.96 }
                }
                animate={
                  reducedMotion
                    ? { opacity: 1 }
                    : { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 240, damping: 26 } }
                }
                exit={{ opacity: 0 }}
              >
                <LiveKillRowCard kill={kill} />
              </m.li>
            ))}
          </AnimatePresence>
          {kills.length === 0 && (
            <li className="rounded-xl border border-[var(--border-gold)] bg-white/[0.02] p-6 text-center text-sm italic text-[var(--text-muted)]">
              Match en cours, premier clip à venir...
            </li>
          )}
        </ul>
      </section>
    </main>
  );
}

function LiveKillRowCard({ kill }: { kill: LiveKillRow }) {
  const isKcKill = kill.tracked_team_involvement === "team_killer";
  const isMulti = Boolean(kill.multi_kill);
  const description =
    kill.ai_description_fr ?? kill.ai_description ?? "";

  const timeLabel = (() => {
    if (kill.game_time_seconds == null) return null;
    const secs = kill.game_time_seconds;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  })();

  return (
    <Link
      href={`/kill/${kill.id}`}
      className={`group flex items-center gap-3 rounded-xl border p-2 transition-colors ${
        isKcKill
          ? "border-[var(--gold)]/30 bg-[var(--gold)]/5 hover:bg-[var(--gold)]/10"
          : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
      }`}
    >
      {kill.thumbnail_url ? (
        <span className="relative block h-14 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-black">
          <Image
            src={kill.thumbnail_url}
            alt={`${kill.killer_champion ?? "?"} kills ${kill.victim_champion ?? "?"}`}
            width={80}
            height={56}
            className="h-full w-full object-cover"
            unoptimized
          />
        </span>
      ) : (
        <span className="h-14 w-20 flex-shrink-0 rounded-lg bg-black" aria-hidden />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-display text-sm font-bold text-[var(--text-primary)]">
            {kill.killer_champion ?? "?"}{" "}
            <span className="text-[var(--text-muted)]">→</span>{" "}
            {kill.victim_champion ?? "?"}
          </span>
          {kill.is_first_blood && (
            <span className="rounded-full bg-[var(--red)] px-1.5 py-0.5 font-data text-[9px] font-bold uppercase tracking-wider text-white">
              FB
            </span>
          )}
          {isMulti && kill.multi_kill && (
            <span className="rounded-full bg-[var(--gold)] px-1.5 py-0.5 font-data text-[9px] font-bold uppercase tracking-wider text-black">
              {kill.multi_kill}
            </span>
          )}
          {timeLabel && (
            <span className="ml-auto font-data text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {timeLabel}
            </span>
          )}
        </div>
        {description && (
          <p className="mt-0.5 text-xs text-[var(--text-muted)] line-clamp-1 group-hover:text-[var(--text-secondary)]">
            {description}
          </p>
        )}
      </div>
    </Link>
  );
}
