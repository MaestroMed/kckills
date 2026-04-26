"use client";

/**
 * useLiveMatch — polls /api/live/kc-status to know whether KC is currently
 * playing a match, so the scroll feed can switch into "mode live" (15s
 * polling cadence + animated banner).
 *
 * Why not React Query : the project doesn't have @tanstack/react-query as a
 * dep and pulling it in just for this hook would bloat the bundle. Instead
 * we recreate the two RQ behaviours we actually need:
 *
 *   1. Dedupe across mounts — module-scoped `cache` holds the last response
 *      and timestamp; a new mount within `STALE_TIME_MS` reuses the cached
 *      value without firing a fetch.
 *   2. Background refetch — a single module-scoped interval keeps the
 *      cache fresh; component subscribers are notified via a tiny
 *      pub/sub list. Multiple mounts share the same poller — no duplicate
 *      network calls.
 *
 * SSR-safe: returns `{ isLive: false }` synchronously on the server. The
 * first client render still gets the placeholder, then the cached/fresh
 * value lands on the next tick.
 *
 * Errors are silent : if /api/live/kc-status 5xx's, we keep the previous
 * value and try again on the next interval. The scroll feed must never
 * break because the live probe failed.
 */

import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 60_000;   // 60s background poll cadence
const STALE_TIME_MS = 30_000;      // dedupe window — mounts within 30s reuse cached value
const ENDPOINT = "/api/live/kc-status";

export interface KcLiveStatus {
  isLive: boolean;
  matchId?: string;
  opponentCode?: string;
  gameNumber?: number;
}

interface CacheEntry {
  status: KcLiveStatus;
  fetchedAt: number;
}

const DEFAULT_STATUS: KcLiveStatus = { isLive: false };

let cache: CacheEntry | null = null;
let inflight: Promise<KcLiveStatus> | null = null;
let pollerHandle: number | null = null;
const subscribers = new Set<(s: KcLiveStatus) => void>();

function emit(status: KcLiveStatus) {
  subscribers.forEach((cb) => {
    try {
      cb(status);
    } catch {
      // a subscriber throwing must not break the others
    }
  });
}

async function fetchStatus(signal?: AbortSignal): Promise<KcLiveStatus> {
  // Coalesce concurrent calls — if a fetch is already inflight, just await
  // its result. This protects against a burst of mounts each kicking off
  // their own request.
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(ENDPOINT, {
        method: "GET",
        cache: "no-store",
        signal,
      });
      if (!res.ok) return DEFAULT_STATUS;
      const json = (await res.json()) as KcLiveStatus;
      // Defensive: validate the shape — server should always return at
      // least { isLive: bool } but a corrupted CDN response shouldn't
      // crash the consumer.
      if (typeof json?.isLive !== "boolean") return DEFAULT_STATUS;
      return json;
    } catch {
      // Network blip / abort / parse error → stay in degraded mode.
      return DEFAULT_STATUS;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function refresh() {
  const status = await fetchStatus();
  cache = { status, fetchedAt: Date.now() };
  emit(status);
}

function ensurePoller() {
  if (typeof window === "undefined") return;
  if (pollerHandle != null) return;
  pollerHandle = window.setInterval(() => {
    void refresh();
  }, POLL_INTERVAL_MS);
}

function teardownPollerIfIdle() {
  if (subscribers.size > 0) return;
  if (pollerHandle != null && typeof window !== "undefined") {
    window.clearInterval(pollerHandle);
    pollerHandle = null;
  }
}

export function useLiveMatch(): KcLiveStatus {
  // SSR : return the default. Hydration mismatch is impossible because the
  // initial client render also starts from this default — the cached value
  // (if any) only lands inside the useEffect below.
  const [status, setStatus] = useState<KcLiveStatus>(() => {
    if (typeof window === "undefined") return DEFAULT_STATUS;
    if (cache && Date.now() - cache.fetchedAt < STALE_TIME_MS) {
      return cache.status;
    }
    return DEFAULT_STATUS;
  });

  useEffect(() => {
    let mounted = true;

    const subscriber = (next: KcLiveStatus) => {
      if (!mounted) return;
      setStatus(next);
    };
    subscribers.add(subscriber);

    // If cache is fresh, push it synchronously (covers the case where the
    // initial useState ran on the SSR pass with no cache, then hydration
    // happens with cache populated by an earlier mount).
    if (cache && Date.now() - cache.fetchedAt < STALE_TIME_MS) {
      setStatus(cache.status);
    } else {
      // Otherwise fire a fresh fetch — coalesced with any inflight one.
      void refresh();
    }

    ensurePoller();

    return () => {
      mounted = false;
      subscribers.delete(subscriber);
      teardownPollerIfIdle();
    };
  }, []);

  return status;
}
