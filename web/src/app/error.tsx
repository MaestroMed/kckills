"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useT } from "@/lib/i18n/use-lang";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
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
        {t("errors.route_title")}
      </h1>
      <p className="text-sm text-[var(--text-muted)]">
        {t("errors.route_body")}
        {error.digest ? (
          <>
            {" "}
            <span className="block mt-2 font-mono text-[10px] text-[var(--text-disabled)]">
              {t("errors.route_ref")}: {error.digest}
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
          {t("errors.try_again")}
        </button>
        <Link
          href="/"
          className="rounded-lg border border-[var(--border-gold)] px-4 py-2 text-sm text-[var(--text-primary)] hover:border-[var(--gold)]"
        >
          {t("errors.back_home")}
        </Link>
      </div>
    </div>
  );
}
