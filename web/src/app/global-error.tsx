"use client";

/**
 * global-error.tsx — last-resort fallback for crashes that take down the
 * root layout itself (`app/layout.tsx`). Next renders this WITHOUT the
 * surrounding chrome, so it MUST own its own <html> and <body>.
 *
 * The standard `error.tsx` only catches errors thrown below the layout;
 * if the layout's own server component throws, only this file saves the
 * tab from a blank document.
 *
 * Inline styles only — Tailwind / globals.css aren't loaded at this
 * level. Keep the markup minimal so it survives even a bundler regression.
 *
 * i18n note : the LangProvider (which powers useT()) lives inside the
 * root layout that just crashed — we cannot rely on it here. We use the
 * client-side useT() hook anyway because it falls back gracefully to
 * DEFAULT_LANG (FR) when no provider is mounted, which is the expected
 * behaviour for a last-resort error page.
 */

import { useEffect } from "react";
import { useT } from "@/lib/i18n/use-lang";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  useEffect(() => {
    console.error("[kckills] global error:", error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#010A13",
          color: "#F0E6D2",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "24px",
        }}
      >
        <main
          role="alert"
          style={{
            maxWidth: 520,
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: 64,
              fontWeight: 900,
              margin: 0,
              color: "#C8AA6E",
              letterSpacing: "-0.02em",
            }}
          >
            ace.
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "16px 0 8px" }}>
            {t("errors.global_title")}
          </h1>
          <p style={{ color: "#A09B8C", fontSize: 14, lineHeight: 1.5, margin: 0 }}>
            {t("errors.global_body")}
            {error.digest ? (
              <span
                style={{
                  display: "block",
                  marginTop: 8,
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 11,
                  color: "#5B6A8A",
                }}
              >
                {t("errors.route_ref")}: {error.digest}
              </span>
            ) : null}
          </p>
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
              marginTop: 24,
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                background: "#C8AA6E",
                color: "#010A13",
                border: "none",
                borderRadius: 8,
                padding: "10px 18px",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {t("errors.try_again")}
            </button>
            <a
              href="/"
              style={{
                color: "#F0E6D2",
                textDecoration: "none",
                border: "1px solid rgba(200,170,110,0.3)",
                borderRadius: 8,
                padding: "10px 18px",
                fontSize: 14,
              }}
            >
              {t("nav.home")}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
