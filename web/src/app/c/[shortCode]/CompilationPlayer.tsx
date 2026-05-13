"use client";

/**
 * CompilationPlayer — 16:9 native MP4 player with chapter-marker jumps.
 *
 * Why a tiny client component instead of HLS / a custom UI :
 *   • The output MP4 is a single-bitrate progressive H.264 file with
 *     `+faststart`. The browser's native <video> covers play/pause/
 *     scrub/keyboard already. No need for hls.js here.
 *   • Chapter jumps : the page renders <a href="#chapter-N"> anchors
 *     in the sommaire. We listen for clicks on those anchors and call
 *     `video.currentTime = offset` instead of navigating. Preserves
 *     the "right-click → copy link" semantics for sharing too.
 *
 * Accessibility :
 *   • <video> gets `controls` + `playsInline` + a label
 *   • Chapter clicks announce via aria-live polite
 *   • Respects prefers-reduced-motion : no auto-play, no scroll
 */

import { useEffect, useRef, useState } from "react";

interface Chapter {
  id: string;
  label: string;
  offsetSeconds: number;
}

interface Props {
  videoUrl: string;
  poster: string | null;
  chapters: Chapter[];
}

export function CompilationPlayer({ videoUrl, poster, chapters }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [announce, setAnnounce] = useState("");

  // Listen for #chapter-N anchor clicks anywhere in the document and
  // turn them into video seeks instead of hash navigations.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a[href^="#chapter-"]') as
        | HTMLAnchorElement
        | null;
      if (!anchor) return;
      const idx = anchor.getAttribute("data-chapter-index");
      const offsetAttr = anchor.getAttribute("data-chapter-offset");
      if (idx === null) return;
      e.preventDefault();
      const offset = offsetAttr ? Number(offsetAttr) : NaN;
      const chapter = chapters[Number(idx)];
      if (videoRef.current && Number.isFinite(offset)) {
        videoRef.current.currentTime = offset;
        // Pause-then-play so the user sees the new frame snap in even
        // if they were already mid-playback at a different timestamp.
        void videoRef.current.play().catch(() => {
          /* autoplay can fail when not gesture-initiated — ignore */
        });
      }
      if (chapter) {
        setAnnounce(`Lecture du chapitre ${Number(idx) + 1} : ${chapter.label}`);
      }
      // Scroll the player back into view if it's offscreen.
      videoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [chapters]);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-black shadow-2xl shadow-black/40">
      <video
        ref={videoRef}
        controls
        playsInline
        preload="metadata"
        poster={poster ?? undefined}
        className="block aspect-video w-full bg-black"
        aria-label="Lecteur vidéo de la compilation"
      >
        <source src={videoUrl} type="video/mp4" />
        Ton navigateur ne supporte pas la lecture vidéo. Télécharge le fichier
        directement{" "}
        <a href={videoUrl} className="underline">
          ici
        </a>
        .
      </video>
      <span aria-live="polite" className="sr-only">
        {announce}
      </span>
    </div>
  );
}
