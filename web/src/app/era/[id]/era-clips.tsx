"use client";

import { useState } from "react";
import { m, AnimatePresence } from "motion/react";
import type { Era, EraLink } from "@/lib/eras";

const LINK_ICONS: Record<string, string> = {
  youtube: "\u25B6",
  article: "\uD83D\uDCF0",
  wiki: "\uD83D\uDCDA",
  twitch: "\uD83D\uDFE3",
};

/** Extract video ID from a YouTube watch URL. Returns null for search results. */
function extractYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  return match ? match[1] : null;
}

function isSearchUrl(url: string): boolean {
  return url.includes("/results?search_query");
}

function youtubeThumb(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function EraClipsSection({ era }: { era: Era }) {
  const [activeClip, setActiveClip] = useState<string | null>(null);

  const directClips = era.links.filter(
    (l) => l.type === "youtube" && extractYouTubeId(l.url)
  );
  const searchLinks = era.links.filter(
    (l) => l.type === "youtube" && isSearchUrl(l.url)
  );
  const otherLinks = era.links.filter((l) => l.type !== "youtube");

  return (
    <section className="relative max-w-7xl mx-auto px-6 py-20">
      <div className="flex items-center gap-3 mb-8">
        <span className="h-px w-12" style={{ backgroundColor: era.color }} />
        <span
          className="font-data text-[10px] uppercase tracking-[0.3em] font-bold"
          style={{ color: era.color }}
        >
          Clips de l&apos;&eacute;poque
        </span>
        <span className="h-px flex-1" style={{ backgroundColor: `${era.color}20` }} />
      </div>

      {/* Direct embeds (real video IDs) */}
      {directClips.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-10">
          {directClips.map((link, i) => {
            const videoId = extractYouTubeId(link.url)!;
            return (
              <m.button
                key={`direct-${i}`}
                onClick={() => setActiveClip(videoId)}
                whileHover={{ y: -4 }}
                transition={{ type: "spring", stiffness: 300, damping: 22 }}
                className="group relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] text-left transition-all hover:border-[var(--gold)]/50"
                style={{ aspectRatio: "16/9" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={youtubeThumb(videoId)}
                  alt={link.label}
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />

                {/* Play button */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <m.div
                    className="flex h-16 w-16 items-center justify-center rounded-full backdrop-blur-md border border-white/30"
                    style={{ backgroundColor: `${era.color}30` }}
                    whileHover={{ scale: 1.15 }}
                    transition={{ type: "spring", stiffness: 400 }}
                  >
                    <svg
                      className="h-6 w-6 translate-x-0.5"
                      fill="white"
                      viewBox="0 0 24 24"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </m.div>
                </div>

                {/* Label */}
                <div className="absolute bottom-0 left-0 right-0 p-4 z-10">
                  <p className="font-display text-sm font-bold text-white leading-tight line-clamp-2">
                    {link.label}
                  </p>
                  <p className="mt-1 text-[10px] text-white/50 uppercase tracking-wider">
                    YouTube &middot; Clip officiel
                  </p>
                </div>
              </m.button>
            );
          })}
        </div>
      )}

      {/* Search-based clip links (until the worker scrapes real clips) */}
      {searchLinks.length > 0 && (
        <div>
          <p className="font-data text-[10px] uppercase tracking-[0.25em] text-white/40 mb-4">
            Recherches YouTube ({searchLinks.length})
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {searchLinks.map((link, i) => (
              <SearchLinkCard key={`search-${i}`} link={link} color={era.color} />
            ))}
          </div>
        </div>
      )}

      {/* Other links */}
      {otherLinks.length > 0 && (
        <div className="mt-8">
          <p className="font-data text-[10px] uppercase tracking-[0.25em] text-white/40 mb-4">
            Ressources
          </p>
          <div className="flex flex-wrap gap-2">
            {otherLinks.map((link, i) => (
              <a
                key={`other-${i}`}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-black/30 backdrop-blur-sm px-4 py-2 text-sm text-white/80 hover:bg-white/10 hover:border-white/30 transition-colors"
              >
                <span>{LINK_ICONS[link.type]}</span>
                {link.label}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox for direct embeds */}
      <AnimatePresence>
        {activeClip && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-xl p-6"
            onClick={() => setActiveClip(null)}
          >
            <m.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="relative w-full max-w-6xl"
              style={{ aspectRatio: "16/9" }}
              onClick={(e) => e.stopPropagation()}
            >
              <iframe
                className="absolute inset-0 w-full h-full rounded-2xl border border-[var(--gold)]/20 shadow-2xl"
                src={`https://www.youtube.com/embed/${activeClip}?autoplay=1&rel=0`}
                title="YouTube clip"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
              <button
                onClick={() => setActiveClip(null)}
                className="absolute -top-12 right-0 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white hover:bg-white/10"
                aria-label="Fermer"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function SearchLinkCard({ link, color }: { link: EraLink; color: string }) {
  return (
    <m.a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      whileHover={{ x: 4 }}
      transition={{ type: "spring", stiffness: 300 }}
      className="group flex items-center gap-4 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 transition-colors hover:border-[var(--gold)]/40"
    >
      <div
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg"
        style={{
          backgroundColor: `${color}15`,
          border: `1px solid ${color}30`,
        }}
      >
        <svg className="h-5 w-5" fill={color} viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-white truncate">{link.label}</p>
        <p className="text-[10px] text-white/40 uppercase tracking-wider mt-0.5">
          Rechercher sur YouTube
        </p>
      </div>
      <svg
        className="h-4 w-4 text-white/30 group-hover:text-white/70 transition-colors flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
      </svg>
    </m.a>
  );
}
