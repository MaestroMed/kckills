"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Era } from "@/lib/eras";
import type { PublishedKillRow } from "@/lib/supabase/kills";
import { SkeletonKillCard } from "@/components/Skeleton";

/**
 * EraKillsFeed — horizontal scrollable strip of clips that fall inside
 * the given KC era's date window. Mounted by HomeTimelineFeed when the
 * user picks an era card in the KC Timeline.
 *
 * Server-rendered fetch is impossible here without forcing the entire
 * homepage to re-render on every era click (the page is a heavy RSC
 * with a 5-min revalidate window). We fetch via /api/kills/by-era
 * which is the same anon-only Supabase read, just packaged behind a
 * cached HTTP endpoint.
 *
 * Visual pattern intentionally mirrors HomeRecentClips so the
 * landing-page feels consistent : 9:16 thumbnail cards, gold border,
 * KC vs OPP chip, highlight score, multi-kill / first-blood badges.
 */
export interface EraKillsFeedProps {
  era: Era;
}

interface ApiResponse {
  era: { id: string; label: string; color: string };
  kills: PublishedKillRow[];
}

export function EraKillsFeed({ era }: EraKillsFeedProps) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; kills: PublishedKillRow[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  // Fetch on era change. AbortController makes the fast-clicking case
  // (user toggling between eras) drop the in-flight request rather
  // than racing a stale response onto a fresh selection.
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: "loading" });
    (async () => {
      try {
        const res = await fetch(
          `/api/kills/by-era?eraId=${encodeURIComponent(era.id)}&limit=30`,
          { signal: ctrl.signal },
        );
        if (!res.ok) {
          // 404 / 500 — fall through to ready+empty so the empty state
          // renders, not an error overlay (we don't want a red banner
          // for the legitimate "no clips for this era yet" case).
          setState({ kind: "ready", kills: [] });
          return;
        }
        const json = (await res.json()) as ApiResponse;
        setState({ kind: "ready", kills: Array.isArray(json.kills) ? json.kills : [] });
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "fetch failed",
        });
      }
    })();
    return () => ctrl.abort();
  }, [era.id]);

  return (
    <section
      className="relative max-w-7xl mx-auto px-4 md:px-6 py-6"
      aria-label={`Clips de l'ere ${era.label}`}
    >
      {/* Header — era badge + title + count */}
      <div className="flex items-end justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span
            className="rounded-md px-3 py-1 font-data text-[11px] font-bold tracking-[0.2em] uppercase backdrop-blur-sm border"
            style={{
              color: era.color,
              backgroundColor: `${era.color}20`,
              borderColor: `${era.color}50`,
            }}
          >
            {era.period}
          </span>
          <h2 className="font-display text-xl md:text-2xl font-black text-white">
            {era.label}
          </h2>
          {state.kind === "ready" && state.kills.length > 0 && (
            <span className="font-data text-xs uppercase tracking-widest text-[var(--text-muted)]">
              {state.kills.length} clip{state.kills.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Loading skeleton — show 4 placeholder cards while we wait. */}
      {state.kind === "loading" && (
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory md:grid md:grid-cols-4 lg:grid-cols-6 md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex-shrink-0 w-32 md:w-auto snap-start">
              <SkeletonKillCard />
            </div>
          ))}
        </div>
      )}

      {/* Empty state — no clips indexed for this era yet. */}
      {state.kind === "ready" && state.kills.length === 0 && (
        <div
          className="rounded-2xl border border-dashed p-10 text-center"
          style={{
            borderColor: `${era.color}40`,
            backgroundColor: `${era.color}08`,
          }}
        >
          <p className="text-sm text-[var(--text-muted)]">
            Pas encore de kills indexes pour cette ere.
          </p>
          <p className="mt-2 text-[11px] text-[var(--text-disabled)] uppercase tracking-widest">
            La pipeline backfill les eras anciennes au fur et a mesure.
          </p>
        </div>
      )}

      {/* Error state — surfaces only when the fetch itself blew up
          (network down, server 500). For empty results we fall through
          to the calmer empty state above. */}
      {state.kind === "error" && (
        <div className="rounded-2xl border border-[var(--red)]/30 bg-[var(--red)]/5 p-6 text-center">
          <p className="text-sm text-[var(--red)]">
            Erreur de chargement : {state.message}
          </p>
        </div>
      )}

      {/* Horizontal strip — same layout pattern as HomeRecentClips so the
          landing surface stays visually consistent. */}
      {state.kind === "ready" && state.kills.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory md:grid md:grid-cols-4 lg:grid-cols-6 md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0">
          {state.kills.slice(0, 18).map((k) => (
            <EraKillCard key={k.id} kill={k} accentColor={era.color} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────

interface EraKillCardProps {
  kill: PublishedKillRow;
  accentColor: string;
}

function EraKillCard({ kill, accentColor }: EraKillCardProps) {
  const matchExt = kill.games?.matches?.external_id ?? null;
  // The opponent code is encoded as the suffix of the match external_id
  // (e.g. "lec_2026_kc_g2" → "G2"). Best-effort — falls back to "?" if
  // the format ever diverges. Mirrors HomeRecentClips behaviour.
  const opp = matchExt
    ? matchExt.split("_").pop()?.toUpperCase().slice(0, 4) ?? ""
    : "";

  return (
    <Link
      href={`/scroll?kill=${kill.id}`}
      className="group flex-shrink-0 w-32 md:w-auto snap-start relative aspect-[9/16] overflow-hidden rounded-xl border bg-[var(--bg-surface)] hover:-translate-y-0.5 transition-all"
      style={{
        borderColor: `${accentColor}40`,
      }}
      aria-label={`${kill.killer_champion ?? "?"} elimine ${kill.victim_champion ?? "?"}`}
    >
      {kill.thumbnail_url && (
        <Image
          src={kill.thumbnail_url}
          alt=""
          fill
          sizes="(max-width: 768px) 128px, 16vw"
          className="object-cover group-hover:scale-105 transition-transform duration-500"
        />
      )}

      {/* Top: opponent + score chips */}
      <div className="absolute top-1.5 left-1.5 right-1.5 flex items-center justify-between gap-1 z-10">
        <span className="rounded bg-black/70 backdrop-blur-sm px-1.5 py-0.5 text-[8px] font-bold text-white">
          KC vs {opp || "?"}
        </span>
        {kill.highlight_score !== null && (
          <span
            className="rounded bg-black/70 backdrop-blur-sm px-1.5 py-0.5 text-[8px] font-bold"
            style={{ color: accentColor }}
          >
            {kill.highlight_score.toFixed(1)}
          </span>
        )}
      </div>

      {/* Multi-kill badge */}
      {kill.multi_kill && (
        <div className="absolute top-7 left-1.5 z-10">
          <span className="rounded bg-[var(--orange)]/90 px-1.5 py-0.5 text-[8px] font-black text-black uppercase tracking-wide">
            {kill.multi_kill}
          </span>
        </div>
      )}

      {/* First blood */}
      {kill.is_first_blood && (
        <div className="absolute top-7 right-1.5 z-10">
          <span className="rounded bg-[var(--red)]/90 px-1.5 py-0.5 text-[8px] font-black text-white uppercase tracking-wide">
            first
          </span>
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

      {/* Bottom: matchup */}
      <div className="absolute bottom-1.5 left-1.5 right-1.5 z-10">
        <p className="font-display text-[11px] font-black text-white leading-tight">
          <span style={{ color: accentColor }}>{kill.killer_champion ?? "?"}</span>
          <span className="text-white/60 mx-0.5">{"\u2192"}</span>
          <span className="text-white/85">{kill.victim_champion ?? "?"}</span>
        </p>
      </div>
    </Link>
  );
}
