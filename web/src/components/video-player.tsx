"use client";

import { useRef, useState } from "react";

interface VideoPlayerProps {
  src?: string | null;
  thumbnail?: string | null;
  title: string;
  youtubeId?: string | null;
  youtubeStart?: number | null;
  youtubeEnd?: number | null;
  status?: string;
}

export function VideoPlayer({
  src,
  thumbnail,
  title,
  youtubeId,
  youtubeStart,
  youtubeEnd,
  status,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [ytLoaded, setYtLoaded] = useState(false);

  // ─── YouTube embed (no infrastructure needed) ───────────────────────────
  if (youtubeId) {
    const params = new URLSearchParams({
      autoplay: ytLoaded ? "1" : "0",
      start: String(youtubeStart ?? 0),
      ...(youtubeEnd ? { end: String(youtubeEnd) } : {}),
      rel: "0",
      modestbranding: "1",
      color: "white",
    });
    const embedUrl = `https://www.youtube.com/embed/${youtubeId}?${params}`;
    const thumbUrl =
      thumbnail ??
      `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`;

    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--border-gold)] bg-black">
        {!ytLoaded ? (
          // Thumbnail with play button
          <button
            className="group relative h-full w-full"
            onClick={() => setYtLoaded(true)}
            aria-label="Lancer le clip"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbUrl}
              alt={title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-black/30 transition-colors group-hover:bg-black/20" />
            {/* Play button */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--gold)] shadow-2xl shadow-[var(--gold)]/30 transition-transform duration-200 group-hover:scale-110">
                <svg
                  className="ml-1.5 h-9 w-9 text-black"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8.118v3.764a1 1 0 001.555.832l3.197-1.882a1 1 0 000-1.664l-3.197-1.882z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            </div>
            {/* Timestamp badge */}
            {youtubeStart && (
              <div className="absolute bottom-3 right-3 rounded-md bg-black/80 px-2 py-1 font-mono text-xs">
                {secondsToGameTime(youtubeStart)}
              </div>
            )}
          </button>
        ) : (
          <iframe
            src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&start=${youtubeStart ?? 0}${youtubeEnd ? `&end=${youtubeEnd}` : ""}&rel=0&modestbranding=1&color=white`}
            title={title}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        )}
      </div>
    );
  }

  // ─── Direct MP4 (R2 hosted) ──────────────────────────────────────────────
  if (src) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-[var(--border-gold)] bg-black">
        <video
          ref={videoRef}
          src={src}
          poster={thumbnail ?? undefined}
          className="h-full w-full object-contain"
          controls
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          aria-label={title}
        />
        {!playing && (
          <button
            className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity hover:bg-black/20"
            onClick={() => videoRef.current?.play()}
            aria-label="Play"
          >
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--gold)] shadow-2xl shadow-[var(--gold)]/30">
              <svg
                className="ml-1.5 h-9 w-9 text-black"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8.118v3.764a1 1 0 001.555.832l3.197-1.882a1 1 0 000-1.664l-3.197-1.882z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          </button>
        )}
      </div>
    );
  }

  // ─── Pending / no clip ───────────────────────────────────────────────────
  const isPending =
    !status ||
    status === "pending" ||
    status === "clipping" ||
    status === "uploading";

  return (
    <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)]">
      <div className="text-center">
        {isPending ? (
          <>
            <div className="mx-auto mb-3 flex h-14 w-14 animate-pulse items-center justify-center rounded-full bg-[var(--gold)]/10">
              <svg
                className="h-7 w-7 text-[var(--gold)]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-[var(--text-muted)]">
              Clip en cours de traitement…
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">
            Aucun clip disponible
          </p>
        )}
      </div>
    </div>
  );
}

function secondsToGameTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
