"use client";

import { useEffect, useRef, useState } from "react";

/**
 * useScrollAutoplay — robust autoplay hook for the TikTok-style /scroll feed.
 *
 * Symptoms it fixes (reported 18 Apr 2026):
 *   • First clip stuck on the poster frame, never starts.
 *   • Browser autoplay policy silently blocks play() with no retry.
 *   • Race: v.currentTime = 0 fires before the video has loaded any data,
 *     which kicks the play promise into a stalled state on Chrome / Safari.
 *
 * What it does:
 *   1. Owns the IntersectionObserver and the play/pause lifecycle.
 *   2. Only seeks to 0 on RE-entry — the first activation plays from start
 *      naturally (the video has nothing to seek to anyway).
 *   3. If play() rejects (autoplay blocked OR data not ready), waits for
 *      `canplay` then retries once. If THAT fails too, exposes
 *      `needsTapToPlay = true` so the UI can show a visible affordance.
 *   4. Keeps the same preload-ladder (next=auto, next+1=metadata,
 *      everything else=none) the previous code had.
 *   5. On de-activation, pauses + downgrades preload for items > 2 away.
 *
 * Usage in an item component:
 *
 *   const { containerRef, videoRef, visible, needsTapToPlay, manualPlay } =
 *     useScrollAutoplay({ index, currentIndexRef, onActivated });
 *
 *   <div ref={containerRef} className="scroll-item">
 *     <video ref={videoRef} muted loop playsInline preload="..." />
 *     {needsTapToPlay && <button onClick={manualPlay}>Tap to play</button>}
 *   </div>
 */

interface Options {
  /** This item's index in the feed. */
  index: number;
  /** Shared ref tracking the currently-visible index — updated when this
   *  item activates so neighbours can compute their preload bucket. */
  currentIndexRef: React.MutableRefObject<number>;
  /** Optional side-effect when the item becomes active (haptics, analytics). */
  onActivated?: () => void;
  /** IntersectionObserver threshold. Default 0.6. */
  threshold?: number;
  /** Item id to write into the URL via history.replaceState when this
   *  item activates. Enables refresh-safe scroll positions: refreshing
   *  /scroll?kill=<id> lands the user back on the same clip instead of
   *  the top. Skips the write for index 0 to avoid an immediate URL
   *  change on cold load. */
  itemId?: string;
}

interface Result {
  containerRef: React.RefObject<HTMLDivElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** True while the item is in the viewport past the threshold. */
  visible: boolean;
  /** True when autoplay was blocked AND the canplay retry also failed.
   *  Render a visible "tap to play" CTA in this case. */
  needsTapToPlay: boolean;
  /** Triggered by the tap-to-play CTA. Counts as a user gesture so the
   *  next play() call always succeeds. */
  manualPlay: () => void;
}

export function useScrollAutoplay(opts: Options): Result {
  const { index, currentIndexRef, onActivated, threshold = 0.6, itemId } = opts;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [needsTapToPlay, setNeedsTapToPlay] = useState(false);
  /** Have we ever played this item before? Lets us skip the seek-to-0
   *  on the very first activation (which is the race that stalled play). */
  const hasPlayedOnceRef = useRef(false);

  /** Robust play helper. Returns void; surfaces failure via state. */
  const tryPlay = (v: HTMLVideoElement) => {
    setNeedsTapToPlay(false);
    const attempt = (): Promise<void> =>
      v.play().then(
        () => {
          hasPlayedOnceRef.current = true;
        },
        () => {
          // First failure — wait for the first frame, then try once more.
          if (v.readyState >= 3 /* HAVE_FUTURE_DATA */) {
            // Already had data — the failure was an autoplay policy block.
            setNeedsTapToPlay(true);
            return;
          }
          const onCanPlay = () => {
            v.removeEventListener("canplay", onCanPlay);
            v.play().then(
              () => {
                hasPlayedOnceRef.current = true;
              },
              () => {
                // Still blocked. Surface the affordance.
                setNeedsTapToPlay(true);
              },
            );
          };
          v.addEventListener("canplay", onCanPlay, { once: true });
          // Make sure we're actually loading — preload="none" would never fire canplay.
          if (v.preload === "none" || !v.preload) v.preload = "auto";
          if (v.networkState === HTMLMediaElement.NETWORK_EMPTY) v.load();
        },
      );
    return attempt();
  };

  const manualPlay = () => {
    const v = videoRef.current;
    if (!v) return;
    setNeedsTapToPlay(false);
    v.play().catch(() => setNeedsTapToPlay(true));
  };

  // Kickstart for index 0: even if the IntersectionObserver fires
  // asynchronously after hydration, we know item #0 is in view from the
  // start. Try to play immediately so the user never sees a frozen
  // poster on first paint.
  // Aggressive autoplay for the first clip — retry on canplay + short delay
  useEffect(() => {
    if (index !== 0) return;
    const v = videoRef.current;
    if (!v) return;
    v.preload = "auto";
    v.muted = true; // ensure muted for autoplay policy
    // Try immediately
    tryPlay(v);
    // Retry after a short delay (covers race where video element isn't
    // fully wired into the DOM yet on hydration)
    const retry = setTimeout(() => {
      if (v.paused && v.readyState >= 2) tryPlay(v);
    }, 500);
    // Also retry on loadeddata (covers slow network first load)
    const onLoaded = () => { if (v.paused) tryPlay(v); };
    v.addEventListener("loadeddata", onLoaded, { once: true });
    return () => {
      clearTimeout(retry);
      v.removeEventListener("loadeddata", onLoaded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        const isVis = entry.isIntersecting;
        setVisible(isVis);
        el.classList.toggle("is-visible", isVis);
        const v = videoRef.current;
        if (!v) return;

        if (isVis) {
          currentIndexRef.current = index;
          onActivated?.();
          if (itemId && index > 0 && typeof window !== "undefined") {
            try {
              const url = new URL(window.location.href);
              if (url.searchParams.get("kill") !== itemId) {
                url.searchParams.set("kill", itemId);
                window.history.replaceState(window.history.state, "", url.toString());
              }
            } catch { /* sandboxed */ }
          }
          // PAUSE ALL OTHER VIDEOS — prevents audio overlap when two
          // items are simultaneously intersecting during scroll transition
          document.querySelectorAll("video").forEach((otherV) => {
            if (otherV !== v && !otherV.paused) {
              otherV.pause();
            }
          });
          if (hasPlayedOnceRef.current) {
            try { v.currentTime = 0; } catch { /* pre-metadata */ }
          }
          v.preload = "auto";
          tryPlay(v);
          // Preload ladder for the 2 items after this one.
          let sibling = el.nextElementSibling;
          for (let i = 0; i < 2 && sibling; i++) {
            const nextV = sibling.querySelector("video");
            if (nextV instanceof HTMLVideoElement) {
              nextV.preload = i === 0 ? "auto" : "metadata";
            }
            sibling = sibling.nextElementSibling;
          }
        } else {
          v.pause();
          if (Math.abs(index - currentIndexRef.current) > 2) {
            v.preload = "none";
          }
        }
      },
      { threshold },
    );

    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, currentIndexRef, threshold]);

  return { containerRef, videoRef, visible, needsTapToPlay, manualPlay };
}
