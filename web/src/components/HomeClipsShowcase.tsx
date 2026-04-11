"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { ERAS, type Era, type EraLink } from "@/lib/eras";

interface CuratedClip {
  videoId: string;
  title: string;
  era: Era;
  link: EraLink;
}

function extractYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  return match ? match[1] : null;
}

function youtubeThumb(videoId: string, quality: "hq" | "maxres" = "hq"): string {
  return `https://i.ytimg.com/vi/${videoId}/${quality}default.jpg`;
}

/**
 * Extracts every era link that points to a real YouTube video (not a search),
 * flattens them into a single list and renders them in a cinematic grid.
 * Each click opens a lightbox with the YouTube embed.
 */
export function HomeClipsShowcase() {
  const [activeClip, setActiveClip] = useState<CuratedClip | null>(null);

  const clips = useMemo<CuratedClip[]>(() => {
    const all: CuratedClip[] = [];
    for (const era of ERAS) {
      for (const link of era.links) {
        if (link.type !== "youtube") continue;
        const videoId = extractYouTubeId(link.url);
        if (!videoId) continue;
        all.push({ videoId, title: link.label, era, link });
      }
    }
    return all;
  }, []);

  if (clips.length === 0) return null;

  return (
    <section className="relative overflow-hidden py-16">
      <div className="max-w-7xl mx-auto px-4">
        {/* Section header */}
        <div className="flex items-center gap-3 mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--gold)]/20 to-transparent" />
          <h2 className="font-display text-2xl md:text-3xl font-black whitespace-nowrap uppercase tracking-wider">
            Highlights <span className="text-gold-gradient">en direct</span>
          </h2>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--gold)]/20 to-transparent" />
        </div>
        <p className="text-center text-xs text-[var(--text-muted)] mb-10 uppercase tracking-[0.25em]">
          {clips.length} clips officiels &middot; cliquez pour regarder
        </p>

        {/* Clips grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {clips.map((clip, i) => (
            <ClipThumbnail
              key={`${clip.era.id}-${clip.videoId}-${i}`}
              clip={clip}
              onClick={() => setActiveClip(clip)}
              index={i}
            />
          ))}
        </div>

        {/* CTA */}
        <div className="mt-10 text-center">
          <Link
            href="/#timeline"
            className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--gold)] uppercase tracking-widest"
          >
            Explorer toutes les &eacute;poques
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {activeClip && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] flex items-center justify-center bg-black/95 backdrop-blur-xl p-6"
            onClick={() => setActiveClip(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              className="relative w-full max-w-6xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close */}
              <button
                onClick={() => setActiveClip(null)}
                className="absolute -top-12 right-0 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white hover:bg-white/10 transition-colors"
                aria-label="Fermer"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Era badge top-left */}
              <div className="absolute -top-12 left-0 flex items-center gap-3">
                <span
                  className="rounded-md px-3 py-1 font-data text-[11px] font-bold tracking-[0.2em] uppercase backdrop-blur-sm border"
                  style={{
                    color: activeClip.era.color,
                    backgroundColor: `${activeClip.era.color}15`,
                    borderColor: `${activeClip.era.color}40`,
                  }}
                >
                  {activeClip.era.label}
                </span>
                <span className="text-white/50 text-xs uppercase tracking-wider">
                  {activeClip.era.period}
                </span>
              </div>

              {/* YouTube embed */}
              <div
                className="relative overflow-hidden rounded-2xl border-2 shadow-2xl"
                style={{
                  borderColor: activeClip.era.color,
                  boxShadow: `0 30px 120px ${activeClip.era.color}40, 0 0 80px ${activeClip.era.color}20`,
                  aspectRatio: "16 / 9",
                }}
              >
                <iframe
                  className="absolute inset-0 w-full h-full"
                  src={`https://www.youtube.com/embed/${activeClip.videoId}?autoplay=1&rel=0&modestbranding=1`}
                  title={activeClip.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>

              {/* Caption + CTA */}
              <div className="mt-5 flex items-end justify-between gap-6 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="font-display text-xl md:text-2xl font-bold text-white">
                    {activeClip.title}
                  </p>
                  <p className="text-xs text-white/40 uppercase tracking-widest mt-1">
                    Esc ou clic en dehors pour fermer
                  </p>
                </div>
                <Link
                  href={`/era/${activeClip.era.id}`}
                  onClick={() => setActiveClip(null)}
                  className="inline-flex items-center gap-3 rounded-xl border px-5 py-3 font-display text-xs font-bold uppercase tracking-widest transition-all hover:scale-105"
                  style={{
                    color: activeClip.era.color,
                    borderColor: `${activeClip.era.color}60`,
                    backgroundColor: `${activeClip.era.color}15`,
                  }}
                >
                  Voir l&apos;&eacute;poque
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function ClipThumbnail({
  clip,
  onClick,
  index,
}: {
  clip: CuratedClip;
  onClick: () => void;
  index: number;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -6, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 260,
        damping: 22,
        delay: Math.min(index * 0.04, 0.4),
      }}
      className="group relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] text-left transition-colors hover:border-[var(--gold)]/60"
      style={{ aspectRatio: "16 / 9" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={youtubeThumb(clip.videoId)}
        alt={clip.title}
        className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
      />

      {/* Dark gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background: `linear-gradient(135deg, ${clip.era.color}25 0%, transparent 60%)`,
        }}
      />

      {/* Era color bar top */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{
          backgroundColor: clip.era.color,
          boxShadow: `0 0 12px ${clip.era.color}80`,
        }}
      />

      {/* Play icon center */}
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          className="flex h-14 w-14 items-center justify-center rounded-full backdrop-blur-md border-2"
          style={{
            backgroundColor: `${clip.era.color}25`,
            borderColor: `${clip.era.color}60`,
          }}
          whileHover={{ scale: 1.2 }}
          transition={{ type: "spring", stiffness: 400 }}
        >
          <svg
            className="h-5 w-5 text-white translate-x-0.5"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </motion.div>
      </div>

      {/* Era badge top-left */}
      <div className="absolute top-3 left-3">
        <span
          className="rounded-md px-2 py-0.5 font-data text-[9px] font-bold tracking-widest uppercase backdrop-blur-sm border"
          style={{
            color: clip.era.color,
            backgroundColor: `${clip.era.color}30`,
            borderColor: `${clip.era.color}60`,
          }}
        >
          {clip.era.period}
        </span>
      </div>

      {/* YouTube logo top-right */}
      <div className="absolute top-3 right-3 rounded-sm bg-red-600/90 backdrop-blur-sm px-1.5 py-0.5">
        <span className="text-[9px] font-black text-white tracking-wider">YOUTUBE</span>
      </div>

      {/* Title bottom */}
      <div className="absolute bottom-0 left-0 right-0 p-4 z-10">
        <p className="font-display text-sm font-bold text-white line-clamp-2 leading-tight">
          {clip.title}
        </p>
        <p className="text-[10px] text-white/50 uppercase tracking-wider mt-1">
          {clip.era.label}
        </p>
      </div>
    </motion.button>
  );
}
