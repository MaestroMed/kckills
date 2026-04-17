"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error to any attached monitoring (Vercel/Sentry/console).
    console.error("[kckills] route error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="font-display text-6xl font-black tracking-tight text-[var(--gold)]">
        GG WP
      </p>
      <h1 className="font-display text-2xl font-bold">
        Le serveur s&apos;est fait first-blood.
      </h1>
      <p className="text-sm text-[var(--text-muted)]">
        Une erreur inattendue est survenue pendant le rendu de cette page.
        {error.digest ? (
          <>
            {" "}
            <span className="block mt-2 font-mono text-[10px] text-[var(--text-disabled)]">
              ref: {error.digest}
            </span>
          </>
        ) : null}
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
          Retour &agrave; l&apos;accueil
        </Link>
      </div>
    </div>
  );
}
