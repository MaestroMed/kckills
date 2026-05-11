"use client";

/**
 * useFloatingPlayer — global audio state for the wolf player.
 *
 * Single source of truth for what's playing, where in the track, mute
 * state, current playlist, and which track is the "next" one. The
 * actual <iframe> lives inside <FloatingPlayerProvider> so it survives
 * route changes (the provider mounts in Providers.tsx, alongside other
 * cross-route singletons like ToastProvider and AuthEventTracker).
 *
 * Autoplay strategy :
 *   * Browsers block audio autoplay until a user gesture happens.
 *   * On first mount we stay PAUSED, but render a "tap the wolf to
 *     start" pulse on the player.
 *   * Once the user clicks anywhere (handled via a one-time `pointerdown`
 *     listener on document.body), we auto-resume IF the user previously
 *     opted-in via localStorage (`kc_audio_enabled = 1`).
 *   * The opt-in flag flips when the user explicitly hits play. So :
 *     1st visit → silent until they tap. Subsequent visits → ambient
 *     music starts on first interaction with the page.
 *
 * Playlist override (Wave 26 — Antre de la BCC) :
 *   * The wolf player normally picks its playlist from the current route
 *     (homepage / scroll). When a context like the Antre modal needs to
 *     hijack the audio (looped OTT track), it calls
 *     `setPlaylistOverride("bcc")`. The override has priority over the
 *     route-derived playlist. Calling `setPlaylistOverride(null)` releases
 *     control and the route-default resumes.
 *
 * Persistence :
 *   * `kc_audio_enabled` (1 / 0) — has the user ever opted in
 *   * `kc_audio_volume` (0..1) — last volume
 *   * `kc_audio_track_id` — last playing track ID (resume on next visit)
 *   * `kc_audio_position_seconds` — saved every 5s (resume position)
 *
 * Diagnostic logging :
 *   * All major state transitions print `console.debug("[wolf]", ...)`
 *     so the user can `localStorage.kc_debug = 1` (or just open devtools)
 *     and see exactly what's happening. Logging is unconditional — these
 *     are debug-level messages, hidden by default in Chrome's filter.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  DEFAULT_PLAYLISTS,
  playlistForRoute,
  shufflePlaylist,
  type BgmTrack,
  type PlaylistId,
} from "./playlists";

/**
 * Local-only YouTube IFrame Player surface — purposely a structural type,
 * NOT a `declare global namespace YT { ... }`. The legacy
 * `web/src/components/scroll/BgmPlayer.tsx` already declares
 * `Window.YT?` with its own inline shape, and TypeScript refuses two
 * different `Window.YT?` declarations in the same compilation unit.
 * Using a local interface keeps both files compile-clean and gives
 * the wolf player exactly the surface it needs (play/pause/seek/volume).
 */
interface YTPlayerLike {
  playVideo: () => void;
  pauseVideo: () => void;
  setVolume: (v: number) => void;
  getCurrentTime?: () => number;
  loadVideoById: (
    args: { videoId: string; startSeconds?: number } | string,
  ) => void;
}

interface FloatingPlayerState {
  /** Currently active playlist key (effective — override OR route-derived). */
  playlistId: PlaylistId;
  /** Tracks queued for play (already shuffled). */
  queue: BgmTrack[];
  /** Index of the currently-loaded track in `queue`. */
  index: number;
  /** Is audio currently playing (vs paused / idle). */
  isPlaying: boolean;
  /** Has the user opted into audio (clicked play at least once). */
  isOptedIn: boolean;
  /** Volume 0..1. */
  volume: number;
  /** Position in current track, seconds. Updated ~once per second. */
  position: number;
  /** Compact (just the wolf head) vs expanded (track info + controls). */
  isExpanded: boolean;
  /** Active override (null = none, "bcc" = cave hijack, etc.). When set,
   *  it bypasses the route-driven playlist selection. */
  playlistOverride: PlaylistId | null;
}

interface FloatingPlayerActions {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  setVolume: (v: number) => void;
  setExpanded: (v: boolean) => void;
  /** Force-load a specific playlist (admin / route changes). */
  loadPlaylist: (id: PlaylistId, opts?: { autoplay?: boolean }) => void;
  /** Pick a specific track from the current queue. */
  jumpTo: (trackIdx: number) => void;
  /**
   * Override the active playlist. When non-null this takes priority over
   * the route-derived playlist (used by the Antre de la BCC to hijack the
   * wolf player). Pass `null` to release control. The opts.autoplay
   * defaults to TRUE because callers want the music to start right away.
   */
  setPlaylistOverride: (
    id: PlaylistId | null,
    opts?: { autoplay?: boolean },
  ) => void;
}

type FloatingPlayerCtx = FloatingPlayerState & FloatingPlayerActions & {
  currentTrack: BgmTrack | null;
  /** ID of the inner <div> the YouTube IFrame API mounts onto. */
  iframeId: string;
};

const Ctx = createContext<FloatingPlayerCtx | null>(null);

const LS_OPTED = "kc_audio_enabled";
const LS_VOLUME = "kc_audio_volume";
const LS_TRACK = "kc_audio_track_id";
const LS_POS = "kc_audio_position_seconds";

function readLS(key: string, fallback: string | null = null): string | null {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* quota / privacy mode — silently swallow */
  }
}

/** Tiny tagged logger — collapses all wolf-player debug output to one
 *  prefix so the user can filter by `[wolf]` in devtools. */
function wlog(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.debug("[wolf]", ...args);
}

export function FloatingPlayerProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const initialPlaylistId: PlaylistId = useMemo(
    () => (typeof window === "undefined" ? "homepage" : playlistForRoute(pathname || "/")),
    // We only want the FIRST mount value here; subsequent route changes
    // are handled in a separate effect that respects user-preferred override.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [playlistId, setPlaylistId] = useState<PlaylistId>(initialPlaylistId);
  const [playlistOverride, setPlaylistOverrideState] =
    useState<PlaylistId | null>(null);
  const [allPlaylists, setAllPlaylists] = useState<Record<PlaylistId, BgmTrack[]>>(
    () => DEFAULT_PLAYLISTS,
  );
  const [queue, setQueue] = useState<BgmTrack[]>(() => {
    const base = DEFAULT_PLAYLISTS[initialPlaylistId];
    return base.length > 0 ? shufflePlaylist(base) : [];
  });

  // Hydrate operator-curated playlists from the public API. Falls back
  // to DEFAULT_PLAYLISTS if the fetch fails. Caches via the route's
  // s-maxage=900 — ~1 request per visitor per 15 min.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/playlists", { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.playlists) return;
        const incoming = data.playlists as Partial<Record<PlaylistId, BgmTrack[]>>;
        // ALWAYS merge with DEFAULT_PLAYLISTS so a missing/empty key
        // (e.g. operator dropped the `bcc` field) doesn't blank out the
        // queue. This was the silent "wolf does nothing on click" bug
        // pre-2026-05-11 : a malformed /api/playlists response set
        // queue → [], currentTrack → undefined, player never inits.
        const merged: Record<PlaylistId, BgmTrack[]> = {
          homepage:
            Array.isArray(incoming.homepage) && incoming.homepage.length > 0
              ? incoming.homepage
              : DEFAULT_PLAYLISTS.homepage,
          scroll:
            Array.isArray(incoming.scroll) && incoming.scroll.length > 0
              ? incoming.scroll
              : DEFAULT_PLAYLISTS.scroll,
          bcc: DEFAULT_PLAYLISTS.bcc,
        };
        wlog("playlists hydrated from /api/playlists", {
          counts: {
            homepage: merged.homepage.length,
            scroll: merged.scroll.length,
            bcc: merged.bcc.length,
          },
        });
        setAllPlaylists(merged);
        // Re-shuffle the active playlist now that we have curated tracks
        const active = merged[playlistId] ?? merged.homepage;
        if (active.length > 0) {
          setQueue(shufflePlaylist<BgmTrack>(active));
        }
      })
      .catch((err) => {
        wlog("playlists fetch failed — using DEFAULT_PLAYLISTS", err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isOptedIn, setIsOptedIn] = useState(false);
  const [volume, setVolumeState] = useState(0.4);
  const [position, setPosition] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);

  const playerRef = useRef<YTPlayerLike | null>(null);
  const positionTimerRef = useRef<number | null>(null);
  /** Queued play request — set when `play()` is called but the YT player
   *  isn't attached yet. Drained by the player's onReady callback (or by
   *  the attach effect when the player arrives later). Critical for the
   *  "click immediately on first mount" UX — without it, the first click
   *  is dropped because playerRef is still null. */
  const pendingPlayRef = useRef<boolean>(false);

  const currentTrack = queue[index] ?? null;

  // ─── LocalStorage hydration on mount ──────────────────────────────
  useEffect(() => {
    const optedIn = readLS(LS_OPTED) === "1";
    const lastVolume = parseFloat(readLS(LS_VOLUME) ?? "0.4");
    const lastTrackId = readLS(LS_TRACK);
    const lastPos = parseFloat(readLS(LS_POS) ?? "0");

    wlog("hydrate from localStorage", {
      optedIn,
      lastVolume,
      lastTrackId,
      lastPos,
    });

    setIsOptedIn(optedIn);
    setVolumeState(Number.isFinite(lastVolume) ? lastVolume : 0.4);

    if (lastTrackId) {
      const found = queue.findIndex((t) => t.id === lastTrackId);
      if (found >= 0) {
        setIndex(found);
        setPosition(Number.isFinite(lastPos) ? lastPos : 0);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Route-driven playlist swap ───────────────────────────────────
  // When user navigates to a different surface, swap to the matching
  // playlist UNLESS they're mid-track on the current one (don't yank
  // their music out from under them on every navigation). If a
  // `playlistOverride` is active (Antre de la BCC), route changes are
  // ignored — the cave controls the player until it releases.
  useEffect(() => {
    if (!pathname) return;
    if (playlistOverride) {
      wlog("route change ignored — override active", { playlistOverride });
      return;
    }
    const next = playlistForRoute(pathname);
    if (next !== playlistId && !isPlaying) {
      wlog("route-driven playlist swap", { from: playlistId, to: next });
      setPlaylistId(next);
      const target = allPlaylists[next];
      setQueue(target && target.length > 0 ? shufflePlaylist(target) : []);
      setIndex(0);
      setPosition(0);
    }
  }, [pathname, playlistId, isPlaying, allPlaylists, playlistOverride]);

  // ─── First-interaction autoplay ──────────────────────────────────
  // After the user has opted-in once, we auto-resume on the next visit
  // as soon as ANY click / tap happens (browser autoplay policy).
  useEffect(() => {
    if (!isOptedIn || isPlaying) return;
    let armed = true;

    const onFirstGesture = () => {
      if (!armed) return;
      armed = false;
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
      wlog("first-gesture autoplay fired");
      // Try to resume — if YT player isn't ready yet, set flag for the
      // onReady callback to pick up.
      if (playerRef.current) {
        try {
          playerRef.current.playVideo();
        } catch (err) {
          wlog("first-gesture playVideo() threw", err);
          pendingPlayRef.current = true;
        }
      } else {
        wlog("first-gesture but no player yet — queueing playVideo()");
        pendingPlayRef.current = true;
      }
    };

    window.addEventListener("pointerdown", onFirstGesture, { once: true });
    window.addEventListener("keydown", onFirstGesture, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
  }, [isOptedIn, isPlaying]);

  // ─── Position polling (1Hz when playing) ─────────────────────────
  useEffect(() => {
    if (!isPlaying) {
      if (positionTimerRef.current) {
        window.clearInterval(positionTimerRef.current);
        positionTimerRef.current = null;
      }
      return;
    }
    positionTimerRef.current = window.setInterval(() => {
      try {
        const t = playerRef.current?.getCurrentTime?.() ?? 0;
        setPosition(t);
        // Persist position every 5 seconds
        if (Math.floor(t) % 5 === 0) {
          writeLS(LS_POS, t.toString());
        }
      } catch {
        /* player not ready */
      }
    }, 1000);
    return () => {
      if (positionTimerRef.current) {
        window.clearInterval(positionTimerRef.current);
        positionTimerRef.current = null;
      }
    };
  }, [isPlaying]);

  // ─── Persistence triggers ────────────────────────────────────────
  useEffect(() => {
    if (currentTrack) writeLS(LS_TRACK, currentTrack.id);
  }, [currentTrack]);

  useEffect(() => {
    writeLS(LS_VOLUME, volume.toString());
  }, [volume]);

  // ─── Actions ─────────────────────────────────────────────────────
  const play = useCallback(() => {
    wlog("play() invoked", {
      hasPlayer: !!playerRef.current,
      playlistId,
      currentTrackId: currentTrack?.id,
    });
    setIsOptedIn(true);
    writeLS(LS_OPTED, "1");
    if (playerRef.current) {
      try {
        playerRef.current.playVideo();
      } catch (err) {
        wlog("playVideo() threw — will retry on onReady", err);
        pendingPlayRef.current = true;
      }
    } else {
      // Player isn't attached yet — queue the play request so the
      // attach effect / onReady callback can pick it up. This is the
      // critical fix for "first click does nothing" : the YT IFrame API
      // is async and the user beats it to the punch.
      wlog("play() queued — YT player not attached yet");
      pendingPlayRef.current = true;
    }
  }, [playlistId, currentTrack?.id]);

  const pause = useCallback(() => {
    wlog("pause() invoked");
    pendingPlayRef.current = false;
    try {
      playerRef.current?.pauseVideo();
    } catch {
      /* swallow */
    }
  }, []);

  const toggle = useCallback(() => {
    wlog("toggle() invoked", { isPlaying });
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  // ─── Auto-advance helper — accounts for single-track loop (BCC) ──
  // The Antre's cave playlist has exactly ONE track. Advancing modulo 1
  // brings us back to index 0 → same track restarts. We re-issue
  // loadVideoById so the YT player actually re-plays instead of
  // stopping at the end. This implements the "loop indefinitely"
  // requirement without needing a dedicated loop flag.
  const advanceTrack = useCallback(
    (direction: 1 | -1) => {
      const len = queue.length;
      if (len === 0) return;
      wlog("advanceTrack", { direction, queueLen: len });
      setIndex((i) => (i + direction + len) % len);
      setPosition(0);
      // Single-track playlist (e.g. bcc) : the modulo-1 advance leaves
      // index at 0 → the (Re)create-player effect won't fire (deps
      // unchanged), so we explicitly tell the YT player to rewind +
      // play. For multi-track playlists the effect handles it because
      // currentTrack?.youtubeId actually changes.
      if (len === 1 && playerRef.current) {
        try {
          playerRef.current.loadVideoById({
            videoId: queue[0].youtubeId,
            startSeconds: 0,
          });
        } catch (err) {
          wlog("loadVideoById (single-track loop) threw", err);
        }
      }
    },
    [queue],
  );

  const next = useCallback(() => advanceTrack(1), [advanceTrack]);
  const prev = useCallback(() => advanceTrack(-1), [advanceTrack]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    try {
      playerRef.current?.setVolume?.(Math.round(clamped * 100));
    } catch {
      /* swallow */
    }
  }, []);

  const setExpanded = useCallback((v: boolean) => setIsExpanded(v), []);

  const loadPlaylist = useCallback(
    (id: PlaylistId, opts: { autoplay?: boolean } = {}) => {
      wlog("loadPlaylist", { id, autoplay: opts.autoplay });
      setPlaylistId(id);
      const target = allPlaylists[id];
      setQueue(target && target.length > 0 ? shufflePlaylist(target) : []);
      setIndex(0);
      setPosition(0);
      if (opts.autoplay) {
        // Defer until the new track loads
        setTimeout(() => play(), 200);
      }
    },
    [play, allPlaylists],
  );

  /** Hijack the player for a specific playlist. The override has
   *  priority over the route-derived playlist (see the route-swap
   *  effect above). Pass null to release. The BCC cave uses this. */
  const setPlaylistOverride = useCallback(
    (id: PlaylistId | null, opts: { autoplay?: boolean } = {}) => {
      const autoplay = opts.autoplay ?? id !== null;
      wlog("setPlaylistOverride", { id, autoplay });
      setPlaylistOverrideState(id);
      if (id === null) {
        // Release : restore the route-default playlist. Don't autoplay
        // unless the caller asked — the user may want silence after
        // closing the cave.
        const routeId = playlistForRoute(pathname || "/");
        setPlaylistId(routeId);
        const target = allPlaylists[routeId];
        setQueue(target && target.length > 0 ? shufflePlaylist(target) : []);
        setIndex(0);
        setPosition(0);
        // Stop the cave track from continuing under the hood — without
        // this it'd keep playing OTT silently behind the homepage.
        try {
          playerRef.current?.pauseVideo();
        } catch {
          /* swallow */
        }
        if (autoplay) setTimeout(() => play(), 200);
        return;
      }
      // Activate override : swap to the target playlist immediately.
      setPlaylistId(id);
      const target = allPlaylists[id];
      setQueue(target && target.length > 0 ? shufflePlaylist(target) : []);
      setIndex(0);
      setPosition(0);
      if (autoplay) setTimeout(() => play(), 200);
    },
    [allPlaylists, pathname, play],
  );

  const jumpTo = useCallback(
    (idx: number) => {
      if (idx >= 0 && idx < queue.length) {
        setIndex(idx);
        setPosition(0);
      }
    },
    [queue.length],
  );

  // ─── Expose iframe attachment via ref ────────────────────────────
  // The actual <iframe> + YT IFrame API setup lives in the visual
  // wolf-player component. It registers its YT.Player via this method.
  const _attachPlayer = useCallback((p: YTPlayerLike | null) => {
    wlog("_attachPlayer", { attached: !!p });
    playerRef.current = p;
    if (p && pendingPlayRef.current) {
      pendingPlayRef.current = false;
      wlog("draining queued play()");
      try {
        p.playVideo();
      } catch (err) {
        wlog("queued playVideo() threw", err);
      }
    }
  }, []);

  const _onPlayerStateChange = useCallback((state: number) => {
    // YT.PlayerState.PLAYING = 1, PAUSED = 2, ENDED = 0
    wlog("YT state change", { state });
    if (state === 1) setIsPlaying(true);
    else if (state === 2) setIsPlaying(false);
    else if (state === 0) {
      setIsPlaying(false);
      // Auto-advance on track end. For single-track playlists (bcc),
      // `next()` reloads the same track via loadVideoById, achieving
      // the loop behaviour.
      next();
    }
  }, [next]);

  const value = useMemo<FloatingPlayerCtx & { _attachPlayer: typeof _attachPlayer; _onPlayerStateChange: typeof _onPlayerStateChange }>(
    () => ({
      playlistId,
      playlistOverride,
      queue,
      index,
      isPlaying,
      isOptedIn,
      volume,
      position,
      isExpanded,
      currentTrack,
      iframeId: "kc-wolf-player-iframe",
      play,
      pause,
      toggle,
      next,
      prev,
      setVolume,
      setExpanded,
      loadPlaylist,
      jumpTo,
      setPlaylistOverride,
      _attachPlayer,
      _onPlayerStateChange,
    }),
    [
      playlistId,
      playlistOverride,
      queue,
      index,
      isPlaying,
      isOptedIn,
      volume,
      position,
      isExpanded,
      currentTrack,
      play,
      pause,
      toggle,
      next,
      prev,
      setVolume,
      setExpanded,
      loadPlaylist,
      jumpTo,
      setPlaylistOverride,
      _attachPlayer,
      _onPlayerStateChange,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFloatingPlayer() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useFloatingPlayer must be used inside FloatingPlayerProvider");
  }
  return ctx;
}

/**
 * Internal-only — the wolf player component uses this to attach its
 * YT.Player instance to the context. Don't call from page code.
 */
export function useFloatingPlayerInternal() {
  const ctx = useContext(Ctx) as
    | (FloatingPlayerCtx & {
        _attachPlayer: (p: YTPlayerLike | null) => void;
        _onPlayerStateChange: (state: number) => void;
      })
    | null;
  if (!ctx) {
    throw new Error("useFloatingPlayerInternal must be used inside FloatingPlayerProvider");
  }
  return ctx;
}
