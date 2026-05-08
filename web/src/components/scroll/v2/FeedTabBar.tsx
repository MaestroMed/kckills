"use client";

/**
 * FeedTabBar — V26 (Wave 24.1).
 *
 * Three pills below the top bar of /scroll : "Pour toi" / "Récent" /
 * "Top semaine". Each writes the `?feed=<key>` query param and
 * triggers a soft-navigate (via router.replace, no scroll) so the
 * server-rendered feed re-orders.
 *
 * The active pill is gold ; the others are muted. Tab state survives
 * back/forward navigation since it lives in the URL.
 */

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

interface Props {
  active: "pour-toi" | "recent" | "top-semaine";
}

const TABS: Array<{ id: Props["active"]; label: string }> = [
  { id: "pour-toi", label: "Pour toi" },
  { id: "recent", label: "Récent" },
  { id: "top-semaine", label: "Top 7j" },
];

export function FeedTabBar({ active }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const buildHref = (next: Props["active"]) => {
    const params = new URLSearchParams(sp.toString());
    if (next === "pour-toi") {
      params.delete("feed");
    } else {
      params.set("feed", next);
    }
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const onClick = (next: Props["active"]) => {
    if (next === active) return;
    startTransition(() => {
      router.replace(buildHref(next), { scroll: false });
    });
  };

  return (
    <div
      role="tablist"
      aria-label="Filtre du feed"
      className={
        "fixed left-1/2 z-40 -translate-x-1/2 flex items-center gap-1 rounded-full border border-[var(--gold)]/20 bg-black/60 backdrop-blur-md px-1 py-1 shadow-lg shadow-black/30 transition-opacity " +
        (pending ? "opacity-70" : "opacity-100")
      }
      style={{
        top: "calc(env(safe-area-inset-top, 0.75rem) + 56px)",
      }}
    >
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onClick(t.id)}
            className={
              "rounded-full px-3 py-1 text-[11px] font-data font-bold uppercase tracking-widest transition-colors " +
              (isActive
                ? "bg-[var(--gold)] text-black"
                : "text-white/70 hover:text-[var(--gold)]")
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
