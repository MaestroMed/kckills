"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

// Dynamic import to avoid SSR issues with Matter.js (needs window/canvas)
const GameCanvas = dynamic(
  () =>
    import("../play/game-canvas").then((mod) => ({
      default: mod.GameCanvas,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#010A13]">
        <div className="text-center space-y-4">
          <div className="kc-spinner mx-auto" />
          <p className="font-display text-sm text-[var(--gold)] uppercase tracking-widest">
            Chargement du Blue Wall...
          </p>
        </div>
      </div>
    ),
  }
);

export default function GameSoloPage() {
  return (
    <>
      <GameCanvas />
      {/* Exit button */}
      <Link
        href="/game"
        className="fixed top-4 left-4 z-[80] flex h-10 w-10 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm border border-white/10 hover:bg-black/80 transition-colors"
      >
        <svg
          className="h-5 w-5 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </Link>
    </>
  );
}
