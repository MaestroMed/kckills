/**
 * Minimal YouTube IFrame API type declarations.
 *
 * We don't pull in @types/youtube to keep the dep tree small —
 * only the surface our wolf floating player actually touches.
 */

declare namespace YT {
  interface PlayerVars {
    autoplay?: 0 | 1;
    controls?: 0 | 1 | 2;
    disablekb?: 0 | 1;
    fs?: 0 | 1;
    iv_load_policy?: 1 | 3;
    modestbranding?: 0 | 1;
    playsinline?: 0 | 1;
    rel?: 0 | 1;
    start?: number;
  }

  interface PlayerEvent {
    target: Player;
  }

  interface OnStateChangeEvent extends PlayerEvent {
    data: number; // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
  }

  interface PlayerOptions {
    videoId?: string;
    width?: number | string;
    height?: number | string;
    playerVars?: PlayerVars;
    events?: {
      onReady?: (e: PlayerEvent) => void;
      onStateChange?: (e: OnStateChangeEvent) => void;
      onError?: (e: { data: number; target: Player }) => void;
    };
  }

  interface Player {
    playVideo(): void;
    pauseVideo(): void;
    stopVideo(): void;
    seekTo(seconds: number, allowSeekAhead?: boolean): void;
    setVolume(volume: number): void; // 0..100
    getVolume(): number;
    mute(): void;
    unMute(): void;
    isMuted(): boolean;
    getCurrentTime(): number;
    getDuration(): number;
    getPlayerState(): number;
    loadVideoById(args: { videoId: string; startSeconds?: number } | string): void;
    cueVideoById(args: { videoId: string; startSeconds?: number } | string): void;
    destroy(): void;
  }

  interface PlayerConstructor {
    new (elementOrId: HTMLElement | string, options: PlayerOptions): Player;
  }

  const Player: PlayerConstructor;
}
