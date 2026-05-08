"use client";

/**
 * useTapAndPress — V2 + V3 (Wave 22.1).
 *
 * Disambiguates four discrete pointer gestures on a feed item :
 *   * single-tap   → toggle play/pause     (V2)
 *   * double-tap   → like (already wired via DoubleTapHeart)
 *   * long-press   → context menu          (V3)
 *   * drag         → forwarded up to useFeedGesture (no-op here)
 *
 * Why a custom hook : `@use-gesture/react` filterTaps already exists
 * but doesn't natively express "single, but only after double-tap
 * window expires" + "long-press at 450ms". This hook owns the
 * timing state.
 *
 * Behavior :
 *   * `pointerdown` → start a 450ms long-press timer + record start.
 *   * If the user moves > MOVE_TOLERANCE px → cancel everything
 *     (treated as a drag, useFeedGesture handles it).
 *   * `pointerup` before 450ms → it's a tap. Defer 220ms to see if
 *     a second tap comes (= double tap). If not → fire onTap.
 *   * `pointerup` AFTER long-press timer fired → no-op (the menu
 *     is already showing, lift just dismisses).
 *
 * Returns `{ bind, isPressing }` — bind spreads onto the gesture
 * surface, `isPressing` lets the parent show a subtle "long-press
 * about to trigger" cue (haptic, ring around the item).
 */

import { useCallback, useEffect, useRef, useState } from "react";

const LONG_PRESS_MS = 450;
const DOUBLE_TAP_WINDOW_MS = 220;
const MOVE_TOLERANCE_PX = 10;

interface Options {
  enabled: boolean;
  onTap?: () => void;
  onDoubleTap?: () => void;
  onLongPress?: () => void;
}

export function useTapAndPress({
  enabled,
  onTap,
  onDoubleTap,
  onLongPress,
}: Options) {
  const [isPressing, setIsPressing] = useState(false);
  const downRef = useRef<{
    x: number;
    y: number;
    t: number;
  } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const lastTapAtRef = useRef<number>(0);
  const tapTimerRef = useRef<number | null>(null);
  const movedRef = useRef(false);

  const cancel = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsPressing(false);
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current != null) {
        window.clearTimeout(longPressTimerRef.current);
      }
      if (tapTimerRef.current != null) {
        window.clearTimeout(tapTimerRef.current);
      }
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return;
      // Only primary buttons (left mouse / single touch).
      if (e.pointerType === "mouse" && e.button !== 0) return;
      downRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
      longPressFiredRef.current = false;
      movedRef.current = false;
      setIsPressing(true);
      longPressTimerRef.current = window.setTimeout(() => {
        if (movedRef.current) return;
        longPressFiredRef.current = true;
        try {
          if (typeof navigator?.vibrate === "function") {
            navigator.vibrate([15, 30, 15]);
          }
        } catch {
          /* navigator.vibrate not supported */
        }
        onLongPress?.();
      }, LONG_PRESS_MS);
    },
    [enabled, onLongPress],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!downRef.current) return;
    const dx = Math.abs(e.clientX - downRef.current.x);
    const dy = Math.abs(e.clientY - downRef.current.y);
    if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) {
      movedRef.current = true;
      cancel();
    }
  }, [cancel]);

  const onPointerUp = useCallback(() => {
    setIsPressing(false);
    if (!downRef.current) return;
    const wasLongPress = longPressFiredRef.current;
    const wasMoved = movedRef.current;
    downRef.current = null;
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (wasLongPress || wasMoved) return;

    // Single vs double tap disambiguation.
    const now = Date.now();
    const sincePrev = now - lastTapAtRef.current;
    if (sincePrev < DOUBLE_TAP_WINDOW_MS) {
      // Cancel the pending single-tap timer.
      if (tapTimerRef.current != null) {
        window.clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      lastTapAtRef.current = 0;
      onDoubleTap?.();
      return;
    }
    lastTapAtRef.current = now;
    tapTimerRef.current = window.setTimeout(() => {
      tapTimerRef.current = null;
      onTap?.();
    }, DOUBLE_TAP_WINDOW_MS);
  }, [onTap, onDoubleTap]);

  const onPointerCancel = useCallback(() => {
    cancel();
    downRef.current = null;
    movedRef.current = false;
    longPressFiredRef.current = false;
  }, [cancel]);

  return {
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
    isPressing,
  };
}
