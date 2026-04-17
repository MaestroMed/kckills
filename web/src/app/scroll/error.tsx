"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ScrollError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[kckills/scroll] feed error:", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[var(--bg-primary)] px-4 text-center">
      <p className="font-display text-5xl font-black text-[var(--gold)]">
        AFK
      </p>
      <h1 className="font-display text-xl font-bold text-[var(--text-primary)]">
        Le feed ne r&eacute;pond plus.
      </h1>
      <p className="text-sm text-[var(--text-muted)]">
        Les clips n&apos;ont pas pu se charger. Tu peux r&eacute;essayer ou revenir
        au lobby.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
        >
          R&eacute;essayer
        </button>
        <Link
          href="/"
          className="rounded-lg border border-[var(--border-gold)] px-4 py-2 text-sm text-[var(--text-primary)] hover:border-[var(--gold)]"
        >
          Retour au lobby
        </Link>
      </div>
      {error.digest ? (
        <p className="mt-4 font-mono text-[10px] text-[var(--text-disabled)]">
          ref: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
