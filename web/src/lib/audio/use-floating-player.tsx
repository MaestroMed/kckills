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
 * Persistence :
 *   * `kc_audio_enabled` (1 / 0) — has the user ever opted in
 *   * `kc_audio_volume` (0..1) — last volume
 *   * `kc_audio_track_id` — last playing track ID (resume on next visit)
 *   * `kc_audio_position_seconds` — saved every 5s (resume position)
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

interface FloatingPlayerState {
  /** Currently active playlist key. */
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
}

type FloatingPlayerCtx = FloatingPlayerState & FloatingPlayerActions & {
  currentTrack: BgmTrack | null;
  /** Audio element ref — used internally + by the visualizer. */
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
  const [allPlaylists, setAllPlaylists] = useState<Record<PlaylistId, BgmTrack[]>>(
    () => DEFAULT_PLAYLISTS,
  );
  const [queue, setQueue] = useState<BgmTrack[]>(() =>
    shufflePlaylist(DEFAULT_PLAYLISTS[initialPlaylistId]),
  );

  // Hydrate operator-curated playlists from the public API. Falls back
  // to DEFAULT_PLAYLISTS if the fetch fails. Caches via the route's
  // s-maxage=900 — ~1 request per visitor per 15 min.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/playlists", { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.playlists) return;
        const fetched = data.playlists as Record<PlaylistId, BgmTrack[]>;
        setAllPlaylists(fetched);
        // Re-shuffle the active playlist now that we have curated tracks
        const fresh: BgmTrack[] = shufflePlaylist<BgmTrack>(
          fetched[playlistId] ?? [],
        );
        setQueue(fresh);
      })
      .catch(() => {
        /* fall back to DEFAULT_PLAYLISTS already in state */
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

  const playerRef = useRef<YT.Player | null>(null);
  const positionTimerRef = useRef<number | null>(null);

  const currentTrack = queue[index] ?? null;

  // ─── LocalStorage hydration on mount ──────────────────────────────
  useEffect(() => {
    const optedIn = readLS(LS_OPTED) === "1";
    const lastVolume = parseFloat(readLS(LS_VOLUME) ?? "0.4");
    const lastTrackId = readLS(LS_TRACK);
    const lastPos = parseFloat(readLS(LS_POS) ?? "0");

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
  // their music out from under them on every navigation).
  useEffect(() => {
    if (!pathname) return;
    const next = playlistForRoute(pathname);
    if (next !== playlistId && !isPlaying) {
      setPlaylistId(next);
      setQueue(shufflePlaylist(allPlaylists[next]));
      setIndex(0);
      setPosition(0);
    }
  }, [pathname, playlistId, isPlaying, allPlaylists]);

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
      // Try to resume — if YT player isn't ready yet, set flag for the
      // onReady callback to pick up.
      try {
        playerRef.current?.playVideo();
      } catch {
        /* swallow — onReady will handle */
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
    setIsOptedIn(true);
    writeLS(LS_OPTED, "1");
    try {
      playerRef.current?.playVideo();
    } catch {
      /* not ready yet */
    }
  }, []);

  const pause = useCallback(() => {
    try {
      playerRef.current?.pauseVideo();
    } catch {
      /* swallow */
    }
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, play, pause]);

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % Math.max(queue.length, 1));
    setPosition(0);
  }, [queue.length]);

  const prev = useCallback(() => {
    setIndex((i) => (i - 1 + queue.length) % Math.max(queue.length, 1));
    setPosition(0);
  }, [queue.length]);

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
      setPlaylistId(id);
      setQueue(shufflePlaylist(allPlaylists[id]));
      setIndex(0);
      setPosition(0);
      if (opts.autoplay) {
        // Defer until the new track loads
        setTimeout(() => play(), 200);
      }
    },
    [play, allPlaylists],
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
  const _attachPlayer = useCallback((p: YT.Player | null) => {
    playerRef.current = p;
  }, []);

  const _onPlayerStateChange = useCallback((state: number) => {
    // YT.PlayerState.PLAYING = 1, PAUSED = 2, ENDED = 0
    if (state === 1) setIsPlaying(true);
    else if (state === 2) setIsPlaying(false);
    else if (state === 0) {
      setIsPlaying(false);
      // Auto-advance on track end
      setIndex((i) => (i + 1) % Math.max(queue.length, 1));
      setPosition(0);
    }
  }, [queue.length]);

  const value = useMemo<FloatingPlayerCtx & { _attachPlayer: typeof _attachPlayer; _onPlayerStateChange: typeof _onPlayerStateChange }>(
    () => ({
      playlistId,
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
      _attachPlayer,
      _onPlayerStateChange,
    }),
    [
      playlistId,
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
        _attachPlayer: (p: YT.Player | null) => void;
        _onPlayerStateChange: (state: number) => void;
      })
    | null;
  if (!ctx) {
    throw new Error("useFloatingPlayerInternal must be used inside FloatingPlayerProvider");
  }
  return ctx;
}
