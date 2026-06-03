"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useT } from "@/lib/i18n/use-lang";

export default function ScrollError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  useEffect(() => {
    console.error("[kckills/scroll] feed error:", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[var(--bg-primary)] px-4 text-center">
      <p className="font-display text-5xl font-black text-[var(--gold)]">
        AFK
      </p>
      <h1 className="font-display text-xl font-bold text-[var(--text-primary)]">
        {t("p_scroll.ban_err_title")}
      </h1>
      <p className="text-sm text-[var(--text-muted)]">
        {t("p_scroll.ban_err_body")}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
        >
          {t("p_scroll.ban_err_retry")}
        </button>
        <Link
          href="/"
          className="rounded-lg border border-[var(--border-gold)] px-4 py-2 text-sm text-[var(--text-primary)] hover:border-[var(--gold)]"
        >
          {t("p_scroll.ban_err_lobby")}
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
