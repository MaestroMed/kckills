"use client";

import { useRef, useEffect, useState } from "react";
import Image from "next/image";
import { championIconUrl } from "@/lib/constants";
import type { RealGame, RealMatch, RealPlayer } from "@/lib/real-data";

interface KillScrollItemProps {
  player: RealPlayer;
  opponent: RealPlayer | null;
  match: RealMatch;
  game: RealGame;
  gameIndex: number;
  isKcKiller: boolean;
}

export function KillScrollItem({
  player,
  opponent,
  match,
  game,
  gameIndex,
  isKcKiller,
}: KillScrollItemProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.5 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const killerName = cleanName(isKcKiller ? player.name : (opponent?.name ?? "?"));
  const victimName = cleanName(isKcKiller ? (opponent?.name ?? "?") : player.name);
  const killerChamp = isKcKiller ? player.champion : (opponent?.champion ?? "?");
  const victimChamp = isKcKiller ? (opponent?.champion ?? "?") : player.champion;
  const kda = `${player.kills}/${player.deaths}/${player.assists}`;
  const date = new Date(match.date);

  return (
    <div
      ref={ref}
      className="scroll-item flex flex-col justify-end bg-[var(--bg-primary)]"
    >
      {/* Background — champion splash placeholder */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative flex items-center gap-6">
          <div className="overflow-hidden rounded-2xl border-2 border-[var(--gold)]/30 shadow-2xl shadow-[var(--gold)]/10">
            <Image
              src={championIconUrl(killerChamp)}
              alt={killerChamp}
              width={120}
              height={120}
              className="object-cover"
            />
          </div>
          <div className="flex flex-col items-center gap-1">
            <svg className="h-8 w-8 text-[var(--gold)]" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">kill</span>
          </div>
          <div className="overflow-hidden rounded-2xl border-2 border-[var(--red)]/30">
            <Image
              src={championIconUrl(victimChamp)}
              alt={victimChamp}
              width={120}
              height={120}
              className="object-cover"
            />
          </div>
        </div>
      </div>

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

      {/* ─── Bottom overlay (info) ────────────────────────────── */}
      <div className="relative z-10 p-5 pb-8 space-y-3">
        {/* KC indicator */}
        <div className="flex items-center gap-2">
          {isKcKiller ? (
            <span className="rounded-md bg-[var(--gold)]/20 px-2 py-0.5 text-[10px] font-bold text-[var(--gold)] uppercase tracking-wider">
              KC Kill
            </span>
          ) : (
            <span className="rounded-md bg-[var(--red)]/20 px-2 py-0.5 text-[10px] font-bold text-[var(--red)] uppercase tracking-wider">
              KC Death
            </span>
          )}
          <span className="text-[10px] text-[var(--text-muted)]">
            Game {game.number} &middot; {match.opponent.code}
          </span>
        </div>

        {/* Killer → Victim */}
        <div className="flex items-center gap-2">
          <span className={`font-display text-lg font-bold ${isKcKiller ? "text-[var(--gold)]" : ""}`}>
            {killerName}
          </span>
          <span className="text-xs text-[var(--text-muted)]">({killerChamp})</span>
          <svg className="h-4 w-4 text-[var(--gold)]" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
          <span className={`font-display text-lg font-bold ${!isKcKiller ? "text-[var(--gold)]" : ""}`}>
            {victimName}
          </span>
          <span className="text-xs text-[var(--text-muted)]">({victimChamp})</span>
        </div>

        {/* Match info */}
        <p className="text-xs text-[var(--text-muted)]">
          KC vs {match.opponent.code} &middot; {match.stage} &middot;{" "}
          {date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
        </p>

        {/* Player KDA bar */}
        <div className="flex items-center gap-3 rounded-xl bg-black/40 px-3 py-2">
          <Image
            src={championIconUrl(player.champion)}
            alt={player.champion}
            width={32}
            height={32}
            className="rounded-full border border-[var(--gold)]/30"
          />
          <div className="flex-1">
            <p className="text-sm font-semibold text-[var(--gold)]">{cleanName(player.name)}</p>
            <p className="text-[10px] text-[var(--text-muted)]">{player.champion}</p>
          </div>
          <p className="font-data text-sm font-bold">
            <span className="text-[var(--green)]">{player.kills}</span>
            /<span className="text-[var(--red)]">{player.deaths}</span>
            /<span className="text-[var(--text-secondary)]">{player.assists}</span>
          </p>
          <p className="text-[10px] text-[var(--text-muted)]">{(player.gold / 1000).toFixed(1)}k</p>
        </div>

        {/* Clip placeholder */}
        <div className="flex items-center justify-center rounded-lg bg-[var(--bg-surface)]/50 py-2">
          <p className="text-[10px] text-[var(--text-disabled)]">
            Clip bient&ocirc;t disponible
          </p>
        </div>
      </div>

      {/* ─── Right sidebar (TikTok style) ─────────────────────── */}
      <div className="absolute right-3 bottom-32 z-10 flex flex-col items-center gap-5">
        {/* Rate */}
        <button className="flex flex-col items-center gap-1" aria-label="Noter">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50">
            <svg className="h-5 w-5 text-[var(--gold)]" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
          </div>
          <span className="text-[10px] text-[var(--text-muted)]">Rate</span>
        </button>

        {/* Comment */}
        <button className="flex flex-col items-center gap-1" aria-label="Commenter">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50">
            <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <span className="text-[10px] text-[var(--text-muted)]">Chat</span>
        </button>

        {/* Share */}
        <button className="flex flex-col items-center gap-1" aria-label="Partager">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50">
            <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </div>
          <span className="text-[10px] text-[var(--text-muted)]">Share</span>
        </button>
      </div>

      {/* Index indicator */}
      <div className="absolute top-4 right-4 z-10 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
        #{gameIndex + 1}
      </div>
    </div>
  );
}

function cleanName(name: string): string {
  return name.replace(/^[A-Z]+ /, "");
}
