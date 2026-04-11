"use client";

import Link from "next/link";
import Image from "next/image";
import {
  championIconUrl,
  formatGameTime,
  KILL_TYPE_LABELS,
  KILL_TYPE_COLORS,
} from "@/lib/constants";
import { StarRating } from "./star-rating";
import type { Kill, Player, Team, Game, Match, Tournament } from "@/types";

interface KillCardProps {
  kill: Kill & {
    killer?: Player;
    victim?: Player;
    game?: Game & {
      match?: Match & {
        team_blue?: Team;
        team_red?: Team;
        tournament?: Tournament;
      };
    };
    youtubeId?: string | null;
    youtubeStart?: number | null;
  };
  compact?: boolean;
}

export function KillCard({ kill, compact = false }: KillCardProps) {
  const matchInfo = kill.game?.match;
  const teamBlue = matchInfo?.team_blue;
  const teamRed = matchInfo?.team_red;
  const tournament = matchInfo?.tournament;
  const hasClip = kill.clip_url || kill.youtubeId;
  const isPenta = kill.kill_type === "penta_kill";

  return (
    <Link href={`/kill/${kill.id}`}>
      <div className={`kill-card h-full overflow-hidden rounded-xl border bg-[var(--bg-surface)] ${isPenta ? "border-[var(--gold)]/50" : "border-[var(--border-gold)]"}`}>

        {/* Thumbnail */}
        <div className="relative aspect-video w-full bg-[var(--bg-surface)] overflow-hidden">

          {/* Champion portrait background */}
          <div className="absolute inset-0 flex items-center justify-center gap-3 px-4">
            <div className={`overflow-hidden rounded-lg border-2 ${kill.kc_is_killer ? "border-[var(--gold)]" : "border-[var(--border-gold)]"}`}
              style={{ width: compact ? 44 : 56, height: compact ? 44 : 56 }}>
              <Image
                src={championIconUrl(kill.killer_champion)}
                alt={kill.killer_champion}
                width={56}
                height={56}
                className="object-cover"
              />
            </div>
            <svg className="h-4 w-4 flex-shrink-0 text-[var(--gold)]" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            <div className={`overflow-hidden rounded-lg border-2 ${kill.kc_is_victim ? "border-[var(--gold)]" : "border-[var(--border-gold)]"}`}
              style={{ width: compact ? 44 : 56, height: compact ? 44 : 56 }}>
              <Image
                src={championIconUrl(kill.victim_champion)}
                alt={kill.victim_champion}
                width={56}
                height={56}
                className="object-cover"
              />
            </div>
          </div>

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

          {/* Kill type badge */}
          {kill.kill_type !== "regular" && (
            <div className="absolute left-2 top-2">
              <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${KILL_TYPE_COLORS[kill.kill_type]}`}>
                {isPenta ? "🏆 PENTA" : KILL_TYPE_LABELS[kill.kill_type]}
              </span>
            </div>
          )}

          {/* KC indicator */}
          {kill.kc_is_killer && (
            <div className="absolute right-2 top-2 rounded-md bg-[var(--gold)] px-1.5 py-0.5 text-[10px] font-black text-black">
              KC KILL
            </div>
          )}
          {kill.kc_is_victim && !kill.kc_is_killer && (
            <div className="absolute right-2 top-2 rounded-md bg-[var(--red)]/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
              KC DEATH
            </div>
          )}

          {/* Game time */}
          <div className="absolute bottom-2 left-2 rounded-md bg-black/80 px-1.5 py-0.5 font-mono text-[10px]">
            {formatGameTime(kill.game_timestamp_ms)}
          </div>

          {/* Play icon if clip available */}
          {hasClip && (
            <div className="absolute bottom-2 right-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--gold)]/90">
                <svg className="ml-0.5 h-3 w-3 text-black" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8.118v3.764a1 1 0 001.555.832l3.197-1.882a1 1 0 000-1.664l-3.197-1.882z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-3">
          {/* Players */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`font-semibold text-sm ${kill.kc_is_killer ? "text-[var(--gold)]" : ""}`}>
              {kill.killer?.summoner_name ?? kill.killer_champion}
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              {kill.killer_champion}
            </span>
            <svg className="h-3 w-3 text-[var(--text-muted)] flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            <span className={`font-semibold text-sm ${kill.kc_is_victim ? "text-[var(--gold)]" : ""}`}>
              {kill.victim?.summoner_name ?? kill.victim_champion}
            </span>
          </div>

          {/* Match info */}
          {!compact && matchInfo && (
            <p className="mt-0.5 text-[10px] text-[var(--text-muted)] truncate">
              {teamBlue?.short_name} vs {teamRed?.short_name}
              {tournament && ` — ${tournament.name}`}
            </p>
          )}

          {/* Rating */}
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <StarRating rating={kill.avg_rating} size="sm" readonly />
              <span className="text-xs font-semibold">
                {kill.avg_rating > 0 ? kill.avg_rating.toFixed(1) : "—"}
              </span>
              {kill.rating_count > 0 && (
                <span className="text-[10px] text-[var(--text-muted)]">
                  ({kill.rating_count})
                </span>
              )}
            </div>
            {kill.comment_count > 0 && (
              <span className="text-[10px] text-[var(--text-muted)]">
                {kill.comment_count} 💬
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
