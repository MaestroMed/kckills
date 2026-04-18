"use client";

/**
 * useNetworkQuality — single source of truth for the feed's bitrate
 * decisions.
 *
 * Reads `navigator.connection` (Network Information API) and exposes a
 * normalized `quality` enum that the pool + HLS adapter can consume:
 *
 *   "auto"  — let the player decide (HLS bitrate ladder negotiation)
 *   "high"  — force the highest variant available (wifi / 5G / saveData=off)
 *   "med"   — force a middle variant (4G shaky)
 *   "low"   — force the lowest variant (3G or worse, saveData=on)
 *
 * Polled passively via the `change` event on connection. We don't poll
 * actively — saves battery and the API is event-driven anyway.
 *
 * Honours `connection.saveData` — if user opted into Data Saver in
 * Chrome / Android settings, we always serve "low" regardless of speed.
 *
 * On browsers without the API (Safari < 17, Firefox), we default to
 * "auto" — HLS will figure it out, MP4 falls back to the medium 720p src.
 */

import { useEffect, useState } from "react";

export type NetworkQuality = "auto" | "high" | "med" | "low";

interface NetworkInformation {
  effectiveType?: string;
  downlink?: number;
  saveData?: boolean;
  addEventListener?: (event: string, fn: () => void) => void;
  removeEventListener?: (event: string, fn: () => void) => void;
}

function detectQuality(conn: NetworkInformation | undefined): NetworkQuality {
  if (!conn) return "auto";
  if (conn.saveData) return "low";
  const eff = conn.effectiveType ?? "";
  const dl = conn.downlink ?? 0;
  if (eff === "2g" || eff === "slow-2g") return "low";
  if (eff === "3g") return dl > 1.5 ? "med" : "low";
  if (eff === "4g") return dl > 5 ? "high" : "med";
  // 5g, wifi, etc — high.
  return "high";
}

export function useNetworkQuality(): {
  quality: NetworkQuality;
  /** Convenience flag for legacy code that just needs "should I serve
   *  the 360p variant?". true when quality is "low". */
  useLowQuality: boolean;
  /** Raw effectiveType string for telemetry / debug overlays. */
  effectiveType: string;
} {
  const [quality, setQuality] = useState<NetworkQuality>("auto");
  const [effectiveType, setEffectiveType] = useState<string>("");

  useEffect(() => {
    const conn = (navigator as unknown as { connection?: NetworkInformation })
      .connection;
    const update = () => {
      setQuality(detectQuality(conn));
      setEffectiveType(conn?.effectiveType ?? "");
    };
    update();
    conn?.addEventListener?.("change", update);
    return () => conn?.removeEventListener?.("change", update);
  }, []);

  return { quality, useLowQuality: quality === "low", effectiveType };
}
