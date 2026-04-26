"use client";

/**
 * SearchBar — sticky-top search input wired to /search (Wave 6, Agent Z).
 *
 * UX :
 *   - Debounced (300ms) — every keystroke schedules a navigate to
 *     /search?q=... AND fires `track('search.executed')`. We do BOTH
 *     immediately on submit (Enter) too, so power users don't wait.
 *   - Keyboard : "/" focuses from anywhere on the page (Twitter style).
 *     Esc clears + blurs.
 *   - Recent searches : last 5 in localStorage, dedup, max 20-char each.
 *     Shown as chip suggestions when the input is focused + empty.
 *   - Mobile : full-width, sticky top with safe-area-inset-top padding.
 *     The input is always visible; no expand/collapse on mobile (the
 *     CommandPalette already covers the "search icon → modal" UX, this
 *     bar is the inline persistent one).
 *   - A11y : role="search", aria-label, focus ring 2px gold.
 *
 * NOT wired to React Query — this project doesn't ship it (per Agent Q's
 * Wave 4 audit). We use plain useState + useEffect with a debounce ref.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { track } from "@/lib/analytics/track";

const STORAGE_KEY = "kckills_recent_searches";
const MAX_RECENT = 5;
const MAX_RECENT_LEN = 20;
const DEBOUNCE_MS = 300;

interface SearchBarProps {
  /** Pre-fill on mount (used by the /search page). */
  initialQuery?: string;
  /** Auto-focus on mount (used by the /search page hero). */
  autoFocus?: boolean;
  /** Optional className override for the outer container. */
  className?: string;
  /** Show the "recent searches" chip strip when focused + empty. Default true. */
  showRecent?: boolean;
}

// ─── Recent searches helpers ──────────────────────────────────────────

/** Read recent searches from localStorage. SSR-safe. */
function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** Push a new query to the front of the recent list (with dedup + cap). */
function pushRecent(query: string): void {
  if (typeof window === "undefined") return;
  const trimmed = query.trim().slice(0, MAX_RECENT_LEN);
  if (!trimmed) return;
  try {
    const current = readRecent();
    // Case-insensitive dedup — keep the new casing.
    const dedup = current.filter((s) => s.toLowerCase() !== trimmed.toLowerCase());
    const next = [trimmed, ...dedup].slice(0, MAX_RECENT);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* localStorage blocked — drop silently */
  }
}

// ─── Component ────────────────────────────────────────────────────────
//
// Next.js 15 requires every consumer of useSearchParams() to be wrapped
// in <Suspense> — without it, importing SearchBar into a server-rendered
// page (navbar.tsx is mounted on every public page including /kill/[id])
// forces that whole page off SSG with a build-time prerender error :
//   "useSearchParams() should be wrapped in a suspense boundary at
//    page /kill/[id]"
// We split into a private SearchBarInner that owns the hook and a public
// SearchBar wrapper that adds the Suspense fence + a minimal fallback
// that matches the input's height/width so the navbar doesn't reflow.
function SearchBarFallback({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative flex items-center gap-2 rounded-lg border border-[var(--border-gold)] bg-black/30 px-3 py-2 ${className}`}
      aria-hidden="true"
    >
      <div className="h-4 w-32 animate-pulse rounded bg-white/5" />
    </div>
  );
}

export function SearchBar(props: SearchBarProps) {
  return (
    <Suspense fallback={<SearchBarFallback className={props.className} />}>
      <SearchBarInner {...props} />
    </Suspense>
  );
}

function SearchBarInner({
  initialQuery,
  autoFocus = false,
  className = "",
  showRecent = true,
}: SearchBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [value, setValue] = useState<string>(initialQuery ?? "");
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);
  const lastNavigatedRef = useRef<string | null>(null);

  // Hydrate recent list once on mount. Doing it lazily (in a state init)
  // would break SSR — localStorage is browser-only.
  useEffect(() => {
    setRecent(readRecent());
  }, []);

  // Re-sync the input when the URL ?q= changes externally (e.g. user
  // clicks a recent-search chip on /search, browser back/forward).
  // Only when we're on /search — on every other page the input is
  // a launcher, not a controlled view of URL state.
  useEffect(() => {
    if (pathname !== "/search") return;
    const urlQ = searchParams.get("q") ?? "";
    setValue(urlQ);
  }, [pathname, searchParams]);

  // Auto-focus on mount if requested. requestAnimationFrame avoids
  // fighting the browser scroll-restoration on initial /search loads.
  useEffect(() => {
    if (!autoFocus) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [autoFocus]);

  // Global "/" hotkey — focuses the input from anywhere. Mimics Twitter.
  // Skip if the user is already typing in an input/textarea/contenteditable
  // OR if a modifier key is held (Ctrl/Cmd-/) so we don't break shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (target.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
      // Select-all so the next keystroke replaces stale text.
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Navigate to /search?q=... and fire the analytics event. Idempotent —
   * if the same query was JUST navigated to, skip. Guards against a
   * keystroke re-firing when the URL change loops back through useEffect.
   */
  const navigateToSearch = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (lastNavigatedRef.current === trimmed) return;
      lastNavigatedRef.current = trimmed;

      const params = new URLSearchParams();
      if (trimmed) params.set("q", trimmed);

      // Preserve existing filter chips on /search when the user types.
      // On other pages, start fresh — the user is launching a new search,
      // not refining one.
      if (pathname === "/search") {
        for (const [k, v] of searchParams.entries()) {
          if (k === "q" || k === "cursor") continue;
          params.set(k, v);
        }
      }

      const qs = params.toString();
      const url = qs ? `/search?${qs}` : "/search";
      router.push(url);

      // Persist + ping analytics. Both wrapped — recent storage isn't
      // critical, analytics is silent-by-design.
      if (trimmed.length > 0) pushRecent(trimmed);
      track("search.executed", {
        metadata: {
          q_len: trimmed.length,
          source: pathname === "/search" ? "search_bar_in_page" : "search_bar_launcher",
        },
      });
    },
    [pathname, router, searchParams],
  );

  // Debounced handler — schedules a navigate 300ms after the last keystroke.
  // The submit handler (Enter) bypasses the debounce for instant feedback.
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setValue(next);

    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      navigateToSearch(next);
      debounceRef.current = null;
    }, DEBOUNCE_MS);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    navigateToSearch(value);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setValue("");
      lastNavigatedRef.current = null;
      // If we're on /search with no query, leave the URL as-is. If we're
      // elsewhere, just blur — the user wanted out.
      inputRef.current?.blur();
    }
  };

  // Show the "recent" suggestion chips when focused + empty.
  const showRecentChips = useMemo(
    () => showRecent && focused && value.length === 0 && recent.length > 0,
    [showRecent, focused, value, recent],
  );

  // Cleanup debounce timer on unmount so we don't navigate after unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <div
      role="search"
      aria-label="Recherche dans les kills"
      className={`relative w-full ${className}`}
    >
      <form onSubmit={onSubmit} className="relative w-full">
        {/* Search icon (decorative — the input has its own aria-label) */}
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--gold)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"
          />
        </svg>
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Delay so a click on a recent-search chip can register
            // before we hide the chip strip.
            window.setTimeout(() => setFocused(false), 150);
          }}
          placeholder="Cherche un champion, un joueur, un kill..."
          aria-label="Recherche dans les kills"
          className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] py-2.5 pl-9 pr-12 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition-all focus:border-[var(--gold)]/60 focus:shadow-[0_0_0_2px_rgba(200,170,110,0.15)]"
        />
        {/* Right-side hint / clear button */}
        {value.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setValue("");
              lastNavigatedRef.current = null;
              if (debounceRef.current !== null) {
                window.clearTimeout(debounceRef.current);
                debounceRef.current = null;
              }
              navigateToSearch("");
              inputRef.current?.focus();
            }}
            aria-label="Effacer la recherche"
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--gold)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden h-5 -translate-y-1/2 items-center rounded border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-1.5 font-mono text-[10px] text-[var(--text-muted)] sm:inline-flex">
            /
          </kbd>
        )}
      </form>

      {/* Recent searches — chip strip below the input when focused + empty */}
      {showRecentChips && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] p-2 shadow-lg"
          // mousedown handler so the click registers BEFORE the input
          // blur which would unmount this strip.
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)]">
            Recherches recentes
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setValue(r);
                  navigateToSearch(r);
                  inputRef.current?.focus();
                }}
                className="rounded-full border border-[var(--border-gold)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/40 hover:text-[var(--gold)]"
              >
                {r}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                try {
                  window.localStorage.removeItem(STORAGE_KEY);
                } catch {
                  /* ignore */
                }
                setRecent([]);
              }}
              className="rounded-full px-2.5 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--red)]"
            >
              Effacer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
