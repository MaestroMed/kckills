"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * AdminGlobalSearch — top-bar search input, scoped to admin entities.
 *
 * Behaviour :
 *   - Typing → debounced 250ms typeahead against /api/admin/global-search
 *   - Enter  → push to /admin/search?q=<query> (full results page)
 *   - Esc    → close dropdown / clear focus
 *   - / shortcut from anywhere on /admin/* → focus the input (vimlike)
 *   - Mobile (<sm) : icon-only ; tap expands to full width
 *
 * The input is uncontrolled by parent — its only side-effect is router
 * navigation on submit. The typeahead dropdown is rendered inline (no
 * portal) since the topbar is sticky and z-30, dropdown lives at z-40.
 */

interface SearchResults {
  kills: { id: string; killer: string; victim: string }[];
  matches: { id: string; external_id: string; label: string }[];
  jobs: { id: string; type: string; status: string }[];
  users: { id: string; label: string }[];
}

const EMPTY: SearchResults = { kills: [], matches: [], jobs: [], users: [] };

export function AdminGlobalSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false); // mobile expand state
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);

  // Debounced fetch
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/global-search?q=${encodeURIComponent(q)}`,
          { signal: ctl.signal },
        );
        if (!res.ok) return;
        const data = (await res.json()) as Partial<SearchResults>;
        setResults({
          kills: data.kills ?? [],
          matches: data.matches ?? [],
          jobs: data.jobs ?? [],
          users: data.users ?? [],
        });
      } catch {
        /* aborted or network — silent */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      ctl.abort();
      clearTimeout(timer);
    };
  }, [query]);

  // Keyboard shortcut: "/" focuses the input (when not already in an input)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      const editable = target.isContentEditable;
      if (editable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!window.location.pathname.startsWith("/admin")) return;
      e.preventDefault();
      inputRef.current?.focus();
      setExpanded(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setExpanded(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const q = query.trim();
      if (!q) return;
      setOpen(false);
      router.push(`/admin/search?q=${encodeURIComponent(q)}`);
    },
    [query, router],
  );

  const totalResults =
    results.kills.length + results.matches.length + results.jobs.length + results.users.length;
  const showDropdown = open && query.trim().length >= 2;

  return (
    <div
      ref={wrapperRef}
      className={`relative ${expanded ? "w-full sm:w-72 lg:w-96" : "w-9 sm:w-72 lg:w-96"} transition-all`}
    >
      {/* Mobile collapsed icon button */}
      <button
        type="button"
        onClick={() => {
          setExpanded(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className={`sm:hidden flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-gold)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--gold)] ${
          expanded ? "hidden" : ""
        }`}
        aria-label="Ouvrir la recherche"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" />
        </svg>
      </button>

      <form
        onSubmit={submit}
        className={`${expanded ? "flex" : "hidden sm:flex"} items-center gap-2 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-2.5 h-9 focus-within:border-[var(--gold)]/50`}
      >
        <svg className="h-3.5 w-3.5 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Recherche : kill, user, match, job ID…"
          aria-label="Recherche admin"
          className="flex-1 min-w-0 bg-transparent text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="hidden lg:inline-flex h-5 items-center rounded border border-[var(--border-gold)] bg-[var(--bg-primary)] px-1 font-data text-[9px] text-[var(--text-muted)]">
          /
        </kbd>
      </form>

      {/* Typeahead dropdown — desktop only (sm+) */}
      {showDropdown && (
        <div
          role="listbox"
          aria-label="Résultats de recherche"
          className="hidden sm:block absolute top-full left-0 right-0 mt-1 max-h-[60vh] overflow-y-auto rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] shadow-2xl z-40"
        >
          {loading && totalResults === 0 ? (
            <div className="px-3 py-4 text-center text-[10px] text-[var(--text-muted)]">
              Recherche en cours…
            </div>
          ) : totalResults === 0 ? (
            <div className="px-3 py-4 text-center text-[10px] text-[var(--text-muted)]">
              Aucun résultat. <span className="text-[var(--text-disabled)]">Appuyer sur Entrée pour la recherche complète.</span>
            </div>
          ) : (
            <div className="py-1">
              {results.kills.length > 0 && (
                <Section title="Kills">
                  {results.kills.map((k) => (
                    <ResultRow
                      key={k.id}
                      href={`/admin/clips/${k.id}`}
                      label={`${k.killer} → ${k.victim}`}
                      hint={k.id.slice(0, 8)}
                      onClick={() => setOpen(false)}
                    />
                  ))}
                </Section>
              )}
              {results.matches.length > 0 && (
                <Section title="Matchs">
                  {results.matches.map((m) => (
                    <ResultRow
                      key={m.id}
                      href={`/admin/pipeline?match=${encodeURIComponent(m.external_id)}`}
                      label={m.label}
                      hint={m.external_id}
                      onClick={() => setOpen(false)}
                    />
                  ))}
                </Section>
              )}
              {results.jobs.length > 0 && (
                <Section title="Jobs pipeline">
                  {results.jobs.map((j) => (
                    <ResultRow
                      key={j.id}
                      href={`/admin/pipeline/jobs/${j.id}`}
                      label={j.type}
                      hint={j.status}
                      onClick={() => setOpen(false)}
                    />
                  ))}
                </Section>
              )}
              {results.users.length > 0 && (
                <Section title="Utilisateurs">
                  {results.users.map((u) => (
                    <ResultRow
                      key={u.id}
                      href={`/admin/audit?actor=${encodeURIComponent(u.id)}`}
                      label={u.label}
                      hint={u.id.slice(0, 8)}
                      onClick={() => setOpen(false)}
                    />
                  ))}
                </Section>
              )}
              <div className="border-t border-[var(--border-gold)] mt-1 px-3 py-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    router.push(`/admin/search?q=${encodeURIComponent(query.trim())}`);
                  }}
                  className="text-[10px] text-[var(--cyan)] hover:underline"
                >
                  Voir tous les résultats →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-1 last:mb-0">
      <div className="px-3 py-1 text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
        {title}
      </div>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function ResultRow({
  href,
  label,
  hint,
  onClick,
}: {
  href: string;
  label: string;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <li>
      <Link
        href={href}
        onClick={onClick}
        className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--gold)]"
      >
        <span className="truncate flex-1">{label}</span>
        {hint && (
          <span className="font-data text-[9px] text-[var(--text-muted)] shrink-0">{hint}</span>
        )}
      </Link>
    </li>
  );
}
