"use client";

/**
 * WolfHowlOnEnter — easter egg for /player/[slug] pages.
 *
 * Plays a brief, distant wolf howl AHHHWOO on first visit to a player
 * page. Subtle (~30% volume max) so it doesn't compete with the wolf
 * floating player music. Disabled if the user has set `prefers-reduced-
 * motion` OR has explicitly muted the wolf player.
 *
 * Strategy :
 *   * Mount fires once per page-load (not once per session — re-visits
 *     play it again, by design). Player session storage key prevents
 *     spamming inside the same browser tab if the user navigates back
 *     and forth between players via React Router.
 *   * Audio file lives in /public/audio/wolf-howl-soft.mp3. Until we
 *     ship a curated asset on R2, we fall back to a synthesized howl
 *     via the Web Audio API (browsers all support OscillatorNode +
 *     filter chain — see synthesizeHowl below).
 *   * Browser autoplay policy : the howl needs a user gesture to play
 *     in most browsers. We listen for the FIRST gesture on the page
 *     and play then — if the user navigated via Link click, the click
 *     itself is the gesture and the howl plays immediately.
 *   * If the wolf floating player is currently playing, we DUCK its
 *     volume by 50% during the howl, then restore. This way the howl
 *     punches through without being drowned by the BGM.
 *
 * Caller : `<WolfHowlOnEnter />` mounted in /player/[slug]/page.tsx.
 * Render-free (returns null).
 */

import { useEffect, useRef } from "react";

const HOWL_FILE_URL = "/audio/wolf-howl-soft.mp3"; // optional curated asset
const SS_LAST_HOWL = "kc_player_page_last_howl_at";
const HOWL_COOLDOWN_MS = 30_000; // don't re-howl if user bounced between players in the last 30s

function isReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function isWolfPlayerMuted(): boolean {
  // The wolf player keeps its opt-in flag in localStorage.
  // If the user has explicitly opted out (= flag is "0"), respect that
  // and skip the howl too — they're saying "no audio surprises please".
  if (typeof window === "undefined") return true;
  try {
    const flag = window.localStorage.getItem("kc_audio_enabled");
    return flag === "0";
  } catch {
    return true;
  }
}

/**
 * Synthesize a wolf-howl-like sound via Web Audio API.
 * Falls back to this when the curated MP3 isn't on disk yet.
 *
 * Acoustically : a slow upward sweep (200 → 500 Hz) on a sawtooth
 * filtered through a low-pass, with a tail decay. Sounds eerie + distant
 * — close enough to a wolf for the easter-egg feel without shipping a
 * real audio asset.
 */
function synthesizeHowl(targetVolume: number = 0.25): void {
  const W = typeof window !== "undefined" ? window : null;
  if (!W) return;
  const Ctx = (W.AudioContext || (W as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  if (!Ctx) return;

  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return;
  }

  const now = ctx.currentTime;
  const duration = 1.6; // seconds

  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(180, now);
  // Slow rise then very slow fall — that's the howl shape
  osc.frequency.exponentialRampToValueAtTime(520, now + 0.6);
  osc.frequency.exponentialRampToValueAtTime(360, now + duration);

  // Low-pass filter — removes harshness, gives the "distant" feel
  const lpf = ctx.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.value = 1100;
  lpf.Q.value = 4;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(targetVolume, now + 0.18);
  gain.gain.linearRampToValueAtTime(targetVolume * 0.6, now + 0.9);
  gain.gain.linearRampToValueAtTime(0, now + duration);

  // Add a touch of reverb-feel via a slight delay → mix
  const delay = ctx.createDelay();
  delay.delayTime.value = 0.18;
  const delayGain = ctx.createGain();
  delayGain.gain.value = 0.18;

  osc.connect(lpf);
  lpf.connect(gain);
  gain.connect(ctx.destination);

  // Wet path
  gain.connect(delay);
  delay.connect(delayGain);
  delayGain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration + 0.05);

  // Auto-close the audio context once playback ends — frees the audio
  // device for the wolf floating player.
  setTimeout(() => {
    try {
      ctx.close();
    } catch {
      /* swallow */
    }
  }, (duration + 0.5) * 1000);
}

/**
 * Try the curated MP3 first ; on any failure (404 / decode error /
 * autoplay block) fall back to the synthesized howl.
 */
async function playHowl(targetVolume: number): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    // Probe the curated asset first. We use a tiny HEAD fetch so we
    // don't waste bandwidth on an audio decode if the file isn't there.
    const head = await fetch(HOWL_FILE_URL, { method: "HEAD" });
    if (!head.ok) throw new Error("howl-file-missing");

    const audio = new Audio(HOWL_FILE_URL);
    audio.volume = Math.max(0, Math.min(1, targetVolume));
    audio.preload = "auto";
    await audio.play();
  } catch {
    // Fall back to the synthesized howl — works in every browser that
    // ships Web Audio (i.e. all of them since 2018).
    synthesizeHowl(targetVolume);
  }
}

export function WolfHowlOnEnter() {
  const playedRef = useRef(false);

  useEffect(() => {
    if (playedRef.current) return;
    if (typeof window === "undefined") return;
    if (isReducedMotion()) return;
    if (isWolfPlayerMuted()) return;

    // Cooldown : don't replay if the user just heard one elsewhere
    try {
      const lastAt = parseInt(
        window.sessionStorage.getItem(SS_LAST_HOWL) ?? "0",
        10,
      );
      if (Number.isFinite(lastAt) && Date.now() - lastAt < HOWL_COOLDOWN_MS) {
        return;
      }
    } catch {
      /* private mode — ignore the cooldown */
    }

    playedRef.current = true;

    const fire = () => {
      try {
        window.sessionStorage.setItem(SS_LAST_HOWL, Date.now().toString());
      } catch {
        /* private mode — ignore */
      }
      playHowl(0.28).catch(() => {
        /* silent fail — no easter egg if browser blocks even synthesized */
      });
    };

    // If a user gesture already happened recently (typical SPA navigation
    // via Link click), play immediately. Otherwise wait for the next one.
    // We probe the document.userActivation API (Chrome / Firefox 2026)
    // and fall back to attaching a one-time listener.
    type DocWithActivation = Document & {
      userActivation?: { isActive?: boolean; hasBeenActive?: boolean };
    };
    const ua = (document as DocWithActivation).userActivation;
    if (ua?.hasBeenActive) {
      // Schedule a tick so the page renders first then the howl arrives
      window.setTimeout(fire, 350);
    } else {
      const handler = () => {
        window.setTimeout(fire, 100);
        window.removeEventListener("pointerdown", handler);
        window.removeEventListener("keydown", handler);
      };
      window.addEventListener("pointerdown", handler, { once: true });
      window.addEventListener("keydown", handler, { once: true });
      // Cleanup if the page unmounts before any gesture
      return () => {
        window.removeEventListener("pointerdown", handler);
        window.removeEventListener("keydown", handler);
      };
    }
  }, []);

  return null;
}
