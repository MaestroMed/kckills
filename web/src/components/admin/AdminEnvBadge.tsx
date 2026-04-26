"use client";

import { useEffect, useState } from "react";

/**
 * AdminEnvBadge — small pill that shows which environment the admin is
 * currently looking at. Helps avoid the classic "fired the destructive
 * action on prod thinking I was on staging" mistake.
 *
 * Detection order :
 *   1. NEXT_PUBLIC_KCKILLS_ENV  — explicit override (set on Vercel)
 *   2. process.env.NODE_ENV === 'development' → "local"
 *   3. window.location.host inference :
 *        - localhost / 127.0.0.1 / *.local                  → local
 *        - *.vercel.app  (preview slug)                     → preview
 *        - kckills.com / www.kckills.com                    → production
 *        - anything else                                    → development
 *
 * The hover tooltip shows : exact env + git branch + commit SHA short.
 * Branch / SHA come from VERCEL_GIT_COMMIT_REF / _SHA — exposed via
 * NEXT_PUBLIC_ versions when set in `next.config.js`. Falls back to "—"
 * when running locally without Vercel build env.
 */
export type AdminEnv = "production" | "preview" | "development" | "local";

interface EnvVisual {
  label: string;
  dot: string;
  bg: string;
  text: string;
  border: string;
}

const VISUALS: Record<AdminEnv, EnvVisual> = {
  production: {
    label: "Production",
    dot: "bg-[var(--green)]",
    bg: "bg-[var(--green)]/10",
    text: "text-[var(--green)]",
    border: "border-[var(--green)]/40",
  },
  preview: {
    label: "Preview",
    dot: "bg-[var(--orange)]",
    bg: "bg-[var(--orange)]/10",
    text: "text-[var(--orange)]",
    border: "border-[var(--orange)]/40",
  },
  development: {
    label: "Dev",
    dot: "bg-[var(--cyan)]",
    bg: "bg-[var(--cyan)]/10",
    text: "text-[var(--cyan)]",
    border: "border-[var(--cyan)]/40",
  },
  local: {
    label: "Local",
    dot: "bg-purple-400",
    bg: "bg-purple-500/10",
    text: "text-purple-300",
    border: "border-purple-400/40",
  },
};

function inferEnvFromHost(host: string): AdminEnv {
  const h = host.toLowerCase();
  if (
    h.startsWith("localhost")
    || h.startsWith("127.")
    || h.endsWith(".local")
    || h.endsWith(".localhost")
  ) {
    return "local";
  }
  if (h.endsWith(".vercel.app")) {
    return "preview";
  }
  if (h === "kckills.com" || h === "www.kckills.com") {
    return "production";
  }
  return "development";
}

function readEnv(): AdminEnv {
  // 1. Explicit override
  const explicit = process.env.NEXT_PUBLIC_KCKILLS_ENV;
  if (explicit === "production" || explicit === "preview" || explicit === "development" || explicit === "local") {
    return explicit;
  }
  // 2. Dev mode shortcut
  if (process.env.NODE_ENV === "development") {
    return "local";
  }
  // 3. Host inference (browser only)
  if (typeof window !== "undefined") {
    return inferEnvFromHost(window.location.host);
  }
  return "development";
}

export function AdminEnvBadge({ size = "sm" }: { size?: "sm" | "xs" }) {
  // Render a stable placeholder during SSR so React hydration doesn't warn.
  // The actual env is detected after mount.
  const [env, setEnv] = useState<AdminEnv | null>(null);

  useEffect(() => {
    setEnv(readEnv());
  }, []);

  const branch = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF || "—";
  const sha = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || "—";

  const visual = env ? VISUALS[env] : VISUALS.development;
  const tooltip = env
    ? `Env : ${env}\nBranche : ${branch}\nCommit : ${sha}`
    : "Détection de l'environnement…";

  const padding = size === "xs" ? "px-1.5 py-0.5" : "px-2 py-1";
  const fontSize = size === "xs" ? "text-[9px]" : "text-[10px]";

  return (
    <span
      title={tooltip}
      role="status"
      aria-label={`Environnement : ${env ?? "inconnu"}`}
      className={`inline-flex items-center gap-1.5 rounded-full border ${visual.bg} ${visual.text} ${visual.border} ${padding} ${fontSize} font-bold uppercase tracking-widest`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${visual.dot}`} />
      {visual.label}
    </span>
  );
}
