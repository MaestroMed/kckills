"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

/**
 * AdminQuickActions — admin-scoped ⌘K palette.
 *
 * Triggered by ⌘K / Ctrl+K from anywhere under /admin/*. Indexes :
 *   - Every admin page (22 entries) with fuzzy search on the label
 *   - Quick actions (trigger backfill / release stale leases / etc)
 *   - Recently visited admin pages (sessionStorage, max 5)
 *
 * Inspired by the public CommandPalette but :
 *   - Admin-scoped routes only (no public pages mixed in)
 *   - Includes ACTIONS that POST to /api/admin/* (not just navigation)
 *   - Mobile : full-screen sheet
 *
 * The trigger is conditionally mounted by the layout — it only renders
 * (and only listens to ⌘K) on /admin/* routes so it never collides with
 * the public CommandPalette on the public site.
 */

const RECENTS_KEY = "kc-admin-palette-recents";
const RECENTS_MAX = 5;

type Group = "navigation" | "action" | "recent";

interface Entry {
  id: string;
  group: Group;
  label: string;
  subtitle?: string;
  href?: string;
  /** When set, executed on Enter instead of navigating. */
  action?: () => Promise<void> | void;
  hint?: string;
  searchText: string;
}

const PAGES: Entry[] = [
  { id: "p-dashboard",      group: "navigation", label: "Dashboard live",     subtitle: "Vue temps réel", href: "/admin",                              searchText: "dashboard live ops home overview accueil" },
  { id: "p-clips",          group: "navigation", label: "Clip Library",       subtitle: "Bibliothèque",   href: "/admin/clips",                        searchText: "clips library bibliotheque kills clip" },
  { id: "p-editorial",      group: "navigation", label: "Editorial",          subtitle: "Curation",       href: "/admin/editorial",                    searchText: "editorial curation curate" },
  { id: "p-featured",       group: "navigation", label: "Featured du jour",   subtitle: "Spotlight",       href: "/admin/featured",                     searchText: "featured spotlight day jour" },
  { id: "p-playlists",      group: "navigation", label: "Wolf player vibes",  subtitle: "Playlists",       href: "/admin/playlists",                    searchText: "playlists wolf vibes audio" },
  { id: "p-bgm",            group: "navigation", label: "BGM (legacy)",       subtitle: "Audio scroll",    href: "/admin/bgm",                          searchText: "bgm music background audio scroll" },
  { id: "p-push",           group: "navigation", label: "Push Broadcast",     subtitle: "Notifications",   href: "/admin/push",                         searchText: "push notifications broadcast send" },
  { id: "p-mod",            group: "navigation", label: "Modération",         subtitle: "Comments",        href: "/admin/moderation",                   searchText: "moderation comments commentaires modere" },
  { id: "p-mod-reports",    group: "navigation", label: "Reports",            subtitle: "Signalements",    href: "/admin/moderation/reports",           searchText: "reports signalements moderation reports" },
  { id: "p-pipeline",       group: "navigation", label: "Daemon Status",      subtitle: "Pipeline",        href: "/admin/pipeline",                     searchText: "pipeline daemon status worker" },
  { id: "p-jobs",           group: "navigation", label: "Job Queue",          subtitle: "pipeline_jobs",   href: "/admin/pipeline/jobs",                searchText: "jobs queue pipeline files attente" },
  { id: "p-trigger",        group: "navigation", label: "Trigger Run",        subtitle: "Lancer un job",   href: "/admin/pipeline/trigger",             searchText: "trigger run lancer pipeline job" },
  { id: "p-run",            group: "navigation", label: "Pipeline Run",       subtitle: "Manual run",      href: "/admin/pipeline/run",                 searchText: "pipeline run manual" },
  { id: "p-dlq",            group: "navigation", label: "Dead Letter",        subtitle: "Jobs morts",      href: "/admin/pipeline/dlq",                 searchText: "dlq dead letter morts failed echec" },
  { id: "p-roster",         group: "navigation", label: "Roster",             subtitle: "Joueurs",         href: "/admin/roster",                       searchText: "roster joueurs players team" },
  { id: "p-analytics",      group: "navigation", label: "Analytics",          subtitle: "Métriques",       href: "/admin/analytics",                    searchText: "analytics metriques umami stats" },
  { id: "p-audit",          group: "navigation", label: "Audit Log",          subtitle: "admin_actions",   href: "/admin/audit",                        searchText: "audit log actions historique trail" },
  { id: "p-perf",           group: "navigation", label: "Web Vitals",         subtitle: "Performance",     href: "/admin/perf",                         searchText: "perf performance web vitals lcp cls fid" },
  { id: "p-lab",            group: "navigation", label: "Lab",                subtitle: "Expérimentations", href: "/admin/lab",                          searchText: "lab experiments evaluations test" },
  { id: "p-search",         group: "navigation", label: "Recherche globale",  subtitle: "Cross-entity",    href: "/admin/search",                       searchText: "search recherche global cross entity" },
];

// Quick actions — POST to /api/admin/* and surface a toast.
function buildActions(notify: (msg: string, ok: boolean) => void): Entry[] {
  const fire = async (
    url: string,
    method: "POST" | "DELETE",
    successMsg: string,
    body?: unknown,
  ) => {
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) {
        notify(successMsg, true);
      } else {
        const err = await res.text();
        notify(`Échec : ${res.status} ${err.slice(0, 80)}`, false);
      }
    } catch (e) {
      notify(`Erreur réseau : ${(e as Error).message}`, false);
    }
  };

  return [
    {
      id: "a-backfill",
      group: "action",
      label: "Lancer backfill complet",
      subtitle: "POST /api/admin/pipeline/run/backfill",
      hint: "POST",
      searchText: "backfill rerun rebuild full reanalyse rejouer",
      action: () => fire("/api/admin/pipeline/run/backfill", "POST", "Backfill démarré"),
    },
    {
      id: "a-channel-recon",
      group: "action",
      label: "Channel reconciler — run now",
      subtitle: "POST /api/admin/pipeline/run/channel-reconcile",
      hint: "POST",
      searchText: "channel reconcile reconciler youtube vod sync",
      action: () =>
        fire("/api/admin/pipeline/run/channel-reconcile", "POST", "Reconciler en cours"),
    },
    {
      id: "a-release-leases",
      group: "action",
      label: "Libérer les leases obsolètes",
      subtitle: "POST /api/admin/pipeline/release-stale",
      hint: "POST",
      searchText: "release stale leases libere obsolete bloque jobs",
      action: () =>
        fire("/api/admin/pipeline/release-stale", "POST", "Leases libérées"),
    },
    {
      id: "a-cache-flush",
      group: "action",
      label: "Flush cache CDN",
      subtitle: "POST /api/admin/cache/flush",
      hint: "POST",
      searchText: "cache flush cdn purge invalidate vider",
      action: () => fire("/api/admin/cache/flush", "POST", "Cache flushé"),
    },
  ];
}

function readRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const cur = readRecents().filter((x) => x !== id);
    const next = [id, ...cur].slice(0, RECENTS_MAX);
    sessionStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — silent */
  }
}

function scoreEntry(entry: Entry, query: string): number {
  if (!query) return 0;
  const q = query.toLowerCase().trim();
  const tokens = q.split(/\s+/).filter(Boolean);
  let score = 0;
  const label = entry.label.toLowerCase();
  for (const tok of tokens) {
    if (!entry.searchText.includes(tok) && !label.includes(tok)) return 0;
    if (label.startsWith(tok)) score += 100;
    else if (label.includes(tok)) score += 40;
    else score += 10;
  }
  // Actions outrank pages slightly (you opened the palette to DO something)
  if (entry.group === "action") score += 5;
  return score;
}

interface Toast {
  msg: string;
  ok: boolean;
  id: number;
}

export function AdminQuickActions() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((msg: string, ok: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, ok }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const ACTIONS = useMemo(() => buildActions(notify), [notify]);

  // ⌘K / Ctrl+K listener — only active when path starts with /admin
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isK = e.key === "k" || e.key === "K";
      if (isK && (e.metaKey || e.ctrlKey)) {
        if (!window.location.pathname.startsWith("/admin")) return;
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Listen for opener event (from topbar button)
  useEffect(() => {
    const onCustom = () => setOpen(true);
    window.addEventListener("kckills:open-admin-palette", onCustom as EventListener);
    return () =>
      window.removeEventListener("kckills:open-admin-palette", onCustom as EventListener);
  }, []);

  useLayoutEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Track recents on path change
  useEffect(() => {
    const path = window.location.pathname;
    const match = PAGES.find((p) => p.href === path);
    if (match) writeRecent(match.id);
  }, []);

  const recents = useMemo(() => {
    if (query.trim()) return [];
    const ids = readRecents();
    const map = new Map(PAGES.map((p) => [p.id, p]));
    return ids
      .map((id) => map.get(id))
      .filter((p): p is Entry => Boolean(p))
      .map((p) => ({ ...p, group: "recent" as const }));
  }, [query, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => {
    const all = [...PAGES, ...ACTIONS];
    if (!query.trim()) {
      // Default view : recents + first 6 actions + all pages (capped)
      return [...recents, ...ACTIONS, ...PAGES.slice(0, 12)];
    }
    return all
      .map((e) => ({ e, s: scoreEntry(e, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 30)
      .map((x) => x.e);
  }, [query, recents, ACTIONS]);

  useEffect(() => {
    if (active >= results.length) setActive(0);
  }, [results.length, active]);

  const grouped = useMemo(() => {
    const map: Record<Group, Entry[]> = { recent: [], action: [], navigation: [] };
    for (const r of results) map[r.group].push(r);
    const order: Group[] = ["recent", "action", "navigation"];
    const flat: Entry[] = [];
    for (const g of order) flat.push(...map[g]);
    return { map, flat, order };
  }, [results]);

  const choose = useCallback(
    async (entry: Entry) => {
      setOpen(false);
      if (entry.action) {
        await entry.action();
        return;
      }
      if (entry.href) {
        writeRecent(entry.id);
        router.push(entry.href);
      }
    },
    [router],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, grouped.flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = grouped.flat[active];
      if (entry) void choose(entry);
    }
  };

  return (
    <>
      {/* Toast tray (always rendered, not gated on `open`) */}
      <div className="fixed bottom-4 right-4 z-[500] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto max-w-xs rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur-md ${
              t.ok
                ? "border-[var(--green)]/40 bg-[var(--green)]/10 text-[var(--green)]"
                : "border-[var(--red)]/40 bg-[var(--red)]/10 text-[var(--red)]"
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>

      {!open ? null : (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Palette d'actions admin"
          className="fixed inset-0 z-[450] flex items-start justify-center bg-black/80 backdrop-blur-md sm:pt-[12vh] px-0 sm:px-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-2xl h-full sm:h-auto overflow-hidden sm:rounded-2xl border border-[var(--gold)]/30 bg-[var(--bg-surface)]/95 shadow-2xl shadow-black/60 flex flex-col"
            style={{ boxShadow: "0 40px 120px rgba(0,0,0,0.7), 0 0 40px rgba(200,170,110,0.15)" }}
          >
            {/* Top gold bar */}
            <div className="h-[2px] bg-gradient-to-r from-transparent via-[var(--gold)] to-transparent" />

            {/* Input */}
            <div className="flex items-center gap-3 border-b border-[var(--border-gold)] px-5 py-4">
              <svg className="h-4 w-4 text-[var(--gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Aller à une page admin ou lancer une action…"
                className="flex-1 bg-transparent text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none font-medium"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="hidden sm:inline-flex h-6 items-center rounded border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-1.5 font-data text-[10px] text-[var(--text-muted)]">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-[70vh] sm:max-h-[60vh] overflow-y-auto px-2 py-2 flex-1" role="listbox">
              {grouped.flat.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                  Aucun résultat pour « {query} »
                </div>
              ) : (
                grouped.order.map((group) => {
                  const entries = grouped.map[group];
                  if (entries.length === 0) return null;
                  return (
                    <div key={group} className="mb-2 last:mb-0">
                      <div className="px-3 py-1.5 text-[10px] font-display font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
                        {group === "recent"
                          ? "Récents"
                          : group === "action"
                            ? "Actions"
                            : "Navigation"}
                      </div>
                      <ul className="space-y-0.5">
                        {entries.map((entry) => {
                          const flatIdx = grouped.flat.indexOf(entry);
                          const isActive = flatIdx === active;
                          return (
                            <li key={entry.id}>
                              <button
                                role="option"
                                aria-selected={isActive}
                                type="button"
                                onMouseEnter={() => setActive(flatIdx)}
                                onClick={() => void choose(entry)}
                                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                                  isActive
                                    ? "bg-[var(--gold)]/15 text-[var(--gold-bright)]"
                                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]/60"
                                }`}
                              >
                                <span
                                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-display font-bold ${
                                    entry.group === "action"
                                      ? "bg-[var(--orange)]/20 text-[var(--orange)]"
                                      : entry.group === "recent"
                                        ? "bg-[var(--cyan)]/20 text-[var(--cyan)]"
                                        : "bg-[var(--bg-elevated)] text-[var(--text-muted)]"
                                  }`}
                                >
                                  {entry.group === "action" ? "⚡" : entry.group === "recent" ? "↻" : "→"}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div
                                    className={`truncate text-sm font-medium ${
                                      isActive ? "text-[var(--gold-bright)]" : "text-[var(--text-primary)]"
                                    }`}
                                  >
                                    {entry.label}
                                  </div>
                                  {entry.subtitle && (
                                    <div className="truncate text-[11px] text-[var(--text-muted)]">
                                      {entry.subtitle}
                                    </div>
                                  )}
                                </div>
                                {entry.hint && (
                                  <span className="shrink-0 rounded border border-[var(--border-gold)] bg-[var(--bg-primary)] px-1.5 py-0.5 font-data text-[10px] text-[var(--gold)]">
                                    {entry.hint}
                                  </span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-[var(--border-gold)] bg-[var(--bg-primary)]/60 px-4 py-2 text-[10px] text-[var(--text-muted)]">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <Kbd>{"↑"}</Kbd>
                  <Kbd>{"↓"}</Kbd>
                  Naviguer
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>{"↵"}</Kbd>
                  Lancer
                </span>
                <span className="flex items-center gap-1">
                  <Kbd>ESC</Kbd>
                  Fermer
                </span>
              </div>
              <span className="hidden sm:inline">Admin palette</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-[16px] items-center justify-center rounded border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-1 font-data text-[9px] text-[var(--text-secondary)]">
      {children}
    </kbd>
  );
}

/** Topbar trigger button — fires the open event without holding state. */
export function AdminQuickActionsButton() {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform));
  }, []);
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("kckills:open-admin-palette"))}
      aria-label="Ouvrir la palette d'actions admin (Cmd+K)"
      className="hidden sm:flex items-center gap-1.5 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)]"
    >
      <span>Actions</span>
      <kbd className="inline-flex h-4 items-center rounded border border-[var(--border-gold)] bg-[var(--bg-primary)] px-1 font-data text-[9px] text-[var(--text-muted)]">
        {mac ? "⌘" : "Ctrl"} K
      </kbd>
    </button>
  );
}
