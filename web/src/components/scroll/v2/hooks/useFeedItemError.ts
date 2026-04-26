"use client";

/**
 * useFeedItemError — listens to the global `kc:clip-error` custom event
 * (fired by FeedPlayerPool's <video onError>) and exposes whether THIS
 * specific feed item is in an error state.
 *
 * Pattern mirrors the existing `kc:clip-played` / `kc:clip-ended`
 * listeners in useFeedItemAnalytics — same dispatch/listener contract,
 * same per-item id filter.
 *
 * Returns:
 *   - errorCode    — string from the pool's MediaError enum lookup, or
 *                    null when the item is NOT in an error state
 *   - retryKey     — bumped by retry(), used as a React key on the
 *                    pool/Image so it remounts and re-attaches the src
 *   - retry        — clears errorCode + bumps retryKey
 */

import { useEffect, useRef, useState } from "react";

export interface FeedItemErrorState {
  /** Non-null when the pool has reported an error for this item. */
  errorCode: string | null;
  /** Monotonic key — bump it (via retry) to force a fresh mount on
   *  whatever consumer keys off it. The pool itself is not remounted
   *  because the slot is shared, but we use this to reset our local
   *  error state so the error UI clears + the next play attempt starts
   *  fresh. */
  retryKey: number;
  /** Drop the error UI + re-attempt. */
  retry: () => void;
}

export function useFeedItemError(itemId: string): FeedItemErrorState {
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  // Track the last error we saw for THIS item — the pool may emit
  // multiple errors during a brief failure (e.g. one per retry attempt
  // inside hls.js) and we want our state to reflect the latest.
  const lastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onError = (ev: Event) => {
      const detail = (ev as CustomEvent<{ itemId?: string; errorCode?: string }>).detail;
      if (!detail || detail.itemId !== itemId) return;
      const code = detail.errorCode ?? "unknown";
      lastErrorRef.current = code;
      setErrorCode(code);
    };
    window.addEventListener("kc:clip-error", onError as EventListener);
    return () => window.removeEventListener("kc:clip-error", onError as EventListener);
  }, [itemId]);

  return {
    errorCode,
    retryKey,
    retry: () => {
      setErrorCode(null);
      lastErrorRef.current = null;
      setRetryKey((k) => k + 1);
    },
  };
}
