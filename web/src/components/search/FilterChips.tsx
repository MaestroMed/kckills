"use client";

/**
 * FilterChips — filter strip for /search (Wave 6, Agent Z).
 *
 * Layout :
 *   - Mobile (<md) : horizontal scrollable `overflow-x-auto snap-x` strip
 *     with momentum scroll. Pill-style toggle buttons; the score slider
 *     gets its own row below the strip.
 *   - Desktop (>=md) : vertical sidebar / column layout. Each filter
 *     section gets a heading and full-width controls.
 *
 * State :
 *   - URL is the source of truth — every chip toggle does
 *     `router.push(/search?...)` and the parent re-reads searchParams.
 *   - "Reset all" wipes every filter param while preserving `q`.
 *
 * Facets :
 *   - tags + players are fetched from /api/search/facets on mount.
 *     Cached client-side for the session (module-scoped). Server-side
 *     it's edge-cached for 1h, so most loads hit CDN.
 *   - Eras come from the static `KC_ERAS` import (no fetch).
 *
 * A11y :
 *   - Each toggle is a real <button> with aria-pressed.
 *   - Active chips have `--gold` background; inactive ones are outlined.
 *   - Focus ring visible on every interactive element.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ERAS } from "@/lib/eras";

// ─── Static config ────────────────────────────────────────────────────

const MULTI_OPTIONS: { id: "double" | "triple" | "quadra" | "penta"; label: string }[] = [
  { id: "double", label: "Double" },
  { id: "triple", label: "Triple" },
  { id: "quadra", label: "Quadra" },
  { id: "penta", label: "Penta" },
];

const KC_ROLE_OPTIONS: { id: "team_killer" | "team_victim" | ""; label: string }[] = [
  { id: "", label: "Tous" },
  { id: "team_killer", label: "KC kill" },
  { id: "team_victim", label: "KC death" },
];

const SCORE_STEPS = [0, 4, 6, 7, 8, 9];

// Wave 31a — community min_rating filter. The kills table avg_rating is
// 0..5 ; UI exposes whole-star steps so the dropdown stays simple.
const RATING_STEPS = [0, 3, 3.5, 4, 4.5];

// ─── Facet types ──────────────────────────────────────────────────────

interface Facets {
  tags: { tag: string; count: number }[];
  players: { slug: string; ign: string; role: string | null; count: number }[];
}

// Module-scoped cache so re-mounts within the same session reuse the
// fetched facets without hitting the network again.
let facetsCache: Facets | null = null;
let facetsPromise: Promise<Facets> | null = null;

async function loadFacets(): Promise<Facets> {
  if (facetsCache) return facetsCache;
  if (facetsPromise) return facetsPromise;
  facetsPromise = (async () => {
    try {
      const res = await fetch("/api/search/facets", { cache: "no-store" });
      if (!res.ok) return { tags: [], players: [] };
      const data = (await res.json()) as Facets;
      facetsCache = data;
      return data;
    } catch {
      return { tags: [], players: [] };
    } finally {
      facetsPromise = null;
    }
  })();
  return facetsPromise;
}

// ─── Component ────────────────────────────────────────────────────────
//
// Wrapped in <Suspense> per Next.js 15 requirement — see SearchBar.tsx
// for the full rationale. /search page imports this AND useSearchParams
// inside it would break SSG of any page that the chip strip transitively
// reaches via a layout import.
function FilterChipsFallback() {
  return (
    <div className="flex h-10 items-center gap-2" aria-hidden="true">
      <div className="h-7 w-16 animate-pulse rounded-full bg-white/5" />
      <div className="h-7 w-20 animate-pulse rounded-full bg-white/5" />
      <div className="h-7 w-24 animate-pulse rounded-full bg-white/5" />
    </div>
  );
}

export function FilterChips() {
  return (
    <Suspense fallback={<FilterChipsFallback />}>
      <FilterChipsInner />
    </Suspense>
  );
}

function FilterChipsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [facets, setFacets] = useState<Facets>(() => facetsCache ?? { tags: [], players: [] });
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [playerDropdownOpen, setPlayerDropdownOpen] = useState(false);
  const [eraDropdownOpen, setEraDropdownOpen] = useState(false);

  // Hydrate facets after mount so we don't block first paint.
  useEffect(() => {
    let cancelled = false;
    loadFacets().then((f) => {
      if (!cancelled) setFacets(f);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Read current filter values from URL.
  const current = useMemo(() => {
    return {
      multi: searchParams.get("multi") ?? "",
      fb: searchParams.get("fb") === "1" || searchParams.get("fb") === "true",
      tag: searchParams.get("tag") ?? "",
      era: searchParams.get("era") ?? "",
      player: searchParams.get("player") ?? "",
      kcRole: searchParams.get("kc_role") ?? "",
      minScore: Number(searchParams.get("min_score") ?? "0"),
      minRating: Number(searchParams.get("min_rating") ?? "0"),
    };
  }, [searchParams]);

  const hasAnyFilter =
    !!current.multi ||
    current.fb ||
    !!current.tag ||
    !!current.era ||
    !!current.player ||
    !!current.kcRole ||
    current.minScore > 0 ||
    current.minRating > 0;

  /**
   * Push a single param change to the URL. `null` removes the key.
   * Always preserves `q` and resets the cursor (the result set
   * may shift). Lands on /search if we're not already there — chip
   * filters from another page are equivalent to "search with no query".
   */
  const setParam = useCallback(
    (key: string, valueOrNull: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("cursor");
      if (valueOrNull == null || valueOrNull === "") {
        next.delete(key);
      } else {
        next.set(key, valueOrNull);
      }
      const qs = next.toString();
      const target = pathname === "/search" ? "/search" : "/search";
      router.push(qs ? `${target}?${qs}` : target);
    },
    [pathname, router, searchParams],
  );

  const resetAll = useCallback(() => {
    const next = new URLSearchParams();
    const q = searchParams.get("q");
    if (q) next.set("q", q);
    const qs = next.toString();
    router.push(qs ? `/search?${qs}` : "/search");
  }, [router, searchParams]);

  return (
    <div className="w-full">
      {/* Mobile + tablet : horizontal chip strip */}
      <div className="md:hidden">
        <div
          className="flex w-full snap-x snap-mandatory gap-2 overflow-x-auto pb-2"
          style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}
        >
          {/* KC role tri-state */}
          {KC_ROLE_OPTIONS.map((opt) => (
            <ChipToggle
              key={opt.id || "all"}
              active={current.kcRole === opt.id}
              onClick={() => setParam("kc_role", opt.id || null)}
              label={opt.label}
            />
          ))}

          {/* Multi-kill chips */}
          {MULTI_OPTIONS.map((m) => (
            <ChipToggle
              key={m.id}
              active={current.multi === m.id}
              onClick={() => setParam("multi", current.multi === m.id ? null : m.id)}
              label={m.label}
            />
          ))}

          {/* First Blood */}
          <ChipToggle
            active={current.fb}
            onClick={() => setParam("fb", current.fb ? null : "1")}
            label="First Blood"
          />

          {/* Era dropdown trigger */}
          <DropdownChip
            active={!!current.era}
            label={current.era ? labelForEra(current.era) : "Epoque"}
            open={eraDropdownOpen}
            onToggle={() => {
              setEraDropdownOpen((v) => !v);
              setTagDropdownOpen(false);
              setPlayerDropdownOpen(false);
            }}
          />

          {/* Tag dropdown trigger */}
          <DropdownChip
            active={!!current.tag}
            label={current.tag ? `#${current.tag}` : "Tag"}
            open={tagDropdownOpen}
            onToggle={() => {
              setTagDropdownOpen((v) => !v);
              setEraDropdownOpen(false);
              setPlayerDropdownOpen(false);
            }}
          />

          {/* Player dropdown trigger */}
          <DropdownChip
            active={!!current.player}
            label={current.player ? capitalize(current.player) : "Joueur"}
            open={playerDropdownOpen}
            onToggle={() => {
              setPlayerDropdownOpen((v) => !v);
              setEraDropdownOpen(false);
              setTagDropdownOpen(false);
            }}
          />

          {hasAnyFilter && (
            <button
              type="button"
              onClick={resetAll}
              className="shrink-0 snap-start rounded-full border border-[var(--red)]/30 bg-[var(--red)]/5 px-3 py-1.5 text-xs text-[var(--red)] transition-colors hover:bg-[var(--red)]/15"
              aria-label="Reinitialiser tous les filtres"
            >
              Reset
            </button>
          )}
        </div>

        {/* Score slider (separate row on mobile to avoid horizontal-scroll slider weirdness) */}
        <div className="mt-2">
          <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
            Score IA min
          </p>
          <ScoreSliderChips
            value={current.minScore}
            onChange={(v) => setParam("min_score", v > 0 ? String(v) : null)}
          />
        </div>

        {/* Wave 31a — community rating filter, mobile row */}
        <div className="mt-2">
          <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
            Note communauté min
          </p>
          <RatingSliderChips
            value={current.minRating}
            onChange={(v) => setParam("min_rating", v > 0 ? String(v) : null)}
          />
        </div>

        {/* Mobile dropdowns (full-width sheet style) */}
        {eraDropdownOpen && (
          <DropdownSheet onClose={() => setEraDropdownOpen(false)}>
            <EraOptions
              current={current.era}
              onPick={(eraId) => {
                setParam("era", eraId);
                setEraDropdownOpen(false);
              }}
            />
          </DropdownSheet>
        )}
        {tagDropdownOpen && (
          <DropdownSheet onClose={() => setTagDropdownOpen(false)}>
            <TagOptions
              tags={facets.tags}
              current={current.tag}
              onPick={(tag) => {
                setParam("tag", tag);
                setTagDropdownOpen(false);
              }}
            />
          </DropdownSheet>
        )}
        {playerDropdownOpen && (
          <DropdownSheet onClose={() => setPlayerDropdownOpen(false)}>
            <PlayerOptions
              players={facets.players}
              current={current.player}
              onPick={(slug) => {
                setParam("player", slug);
                setPlayerDropdownOpen(false);
              }}
            />
          </DropdownSheet>
        )}
      </div>

      {/* Desktop : vertical sidebar */}
      <aside className="hidden md:block w-full">
        <FilterSection title="KC">
          <div className="flex flex-wrap gap-1.5">
            {KC_ROLE_OPTIONS.map((opt) => (
              <ChipToggle
                key={opt.id || "all"}
                active={current.kcRole === opt.id}
                onClick={() => setParam("kc_role", opt.id || null)}
                label={opt.label}
              />
            ))}
          </div>
        </FilterSection>

        <FilterSection title="Multi-kill">
          <div className="flex flex-wrap gap-1.5">
            {MULTI_OPTIONS.map((m) => (
              <ChipToggle
                key={m.id}
                active={current.multi === m.id}
                onClick={() => setParam("multi", current.multi === m.id ? null : m.id)}
                label={m.label}
              />
            ))}
          </div>
        </FilterSection>

        <FilterSection title="Special">
          <ChipToggle
            active={current.fb}
            onClick={() => setParam("fb", current.fb ? null : "1")}
            label="First Blood"
          />
        </FilterSection>

        <FilterSection title="Epoque">
          <select
            value={current.era}
            onChange={(e) => setParam("era", e.target.value || null)}
            className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)] outline-none focus:border-[var(--gold)]/60"
            aria-label="Filtrer par epoque"
          >
            <option value="">Toutes les epoques</option>
            {ERAS.map((era) => (
              <option key={era.id} value={era.id}>
                {era.label} ({era.period})
              </option>
            ))}
          </select>
        </FilterSection>

        <FilterSection title="Tag IA">
          <select
            value={current.tag}
            onChange={(e) => setParam("tag", e.target.value || null)}
            className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)] outline-none focus:border-[var(--gold)]/60"
            aria-label="Filtrer par tag IA"
          >
            <option value="">Tous les tags</option>
            {facets.tags.map((t) => (
              <option key={t.tag} value={t.tag}>
                #{t.tag} ({t.count})
              </option>
            ))}
          </select>
        </FilterSection>

        <FilterSection title="Joueur">
          <select
            value={current.player}
            onChange={(e) => setParam("player", e.target.value || null)}
            className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)] outline-none focus:border-[var(--gold)]/60"
            aria-label="Filtrer par joueur"
          >
            <option value="">Tous les joueurs</option>
            {facets.players.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.ign}
                {p.role ? ` (${p.role})` : ""}
                {p.count > 0 ? ` - ${p.count}` : ""}
              </option>
            ))}
          </select>
        </FilterSection>

        <FilterSection title="Score IA min">
          <ScoreSliderChips
            value={current.minScore}
            onChange={(v) => setParam("min_score", v > 0 ? String(v) : null)}
          />
        </FilterSection>

        <FilterSection title="Note communauté min">
          <RatingSliderChips
            value={current.minRating}
            onChange={(v) => setParam("min_rating", v > 0 ? String(v) : null)}
          />
        </FilterSection>

        {hasAnyFilter && (
          <button
            type="button"
            onClick={resetAll}
            className="mt-4 w-full rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/5 py-2 text-sm font-medium text-[var(--red)] transition-colors hover:bg-[var(--red)]/15"
          >
            Reinitialiser tous les filtres
          </button>
        )}
      </aside>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function ChipToggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 snap-start rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] ${
        active
          ? "border-[var(--gold)] bg-[var(--gold)] text-[var(--bg-primary)]"
          : "border-[var(--border-gold)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)]"
      }`}
    >
      {label}
    </button>
  );
}

function DropdownChip({
  active,
  label,
  open,
  onToggle,
}: {
  active: boolean;
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-haspopup="listbox"
      className={`shrink-0 snap-start rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] ${
        active
          ? "border-[var(--gold)] bg-[var(--gold)] text-[var(--bg-primary)]"
          : "border-[var(--border-gold)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)]"
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
        </svg>
      </span>
    </button>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-2 font-display text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">
        {title}
      </p>
      {children}
    </div>
  );
}

function ScoreSliderChips({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {SCORE_STEPS.map((step) => {
        const active = value === step;
        const label = step === 0 ? "Tous" : `${step}+`;
        return (
          <button
            key={step}
            type="button"
            onClick={() => onChange(step)}
            aria-pressed={active}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] ${
              active
                ? "border-[var(--gold)] bg-[var(--gold)] text-[var(--bg-primary)]"
                : "border-[var(--border-gold)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--gold)]/40"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Community avg_rating slider (Wave 31a). Same shape as ScoreSliderChips
 *  but uses the 0..5 rating scale + a star glyph. RATING_STEPS includes
 *  half-stars (3.5, 4.5) since community ratings are computed averages. */
function RatingSliderChips({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {RATING_STEPS.map((step) => {
        const active = value === step;
        const label =
          step === 0 ? "Tous" : `${step.toString().replace(".", ",")}★+`;
        return (
          <button
            key={step}
            type="button"
            onClick={() => onChange(step)}
            aria-pressed={active}
            aria-label={
              step === 0
                ? "Toutes notes"
                : `Note minimum ${step} étoiles sur 5`
            }
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] ${
              active
                ? "border-[var(--gold)] bg-[var(--gold)] text-[var(--bg-primary)]"
                : "border-[var(--border-gold)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--gold)]/40"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function DropdownSheet({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  // Mobile-first bottom sheet. Tap-outside-to-close + Escape support.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[300] flex items-end justify-center bg-black/60 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-[var(--gold)]/30 bg-[var(--bg-surface)] p-4 shadow-2xl"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--text-muted)]/30" />
        {children}
      </div>
    </div>
  );
}

function EraOptions({
  current,
  onPick,
}: {
  current: string;
  onPick: (eraId: string) => void;
}) {
  return (
    <ul role="listbox" className="space-y-1">
      <li>
        <button
          type="button"
          onClick={() => onPick("")}
          className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
            !current
              ? "bg-[var(--gold)]/15 text-[var(--gold-bright)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
          }`}
        >
          Toutes les epoques
        </button>
      </li>
      {ERAS.map((era) => (
        <li key={era.id}>
          <button
            type="button"
            onClick={() => onPick(era.id)}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              current === era.id
                ? "bg-[var(--gold)]/15 text-[var(--gold-bright)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            }`}
          >
            <span className="font-semibold">{era.label}</span>
            <span className="ml-2 text-[11px] text-[var(--text-muted)]">{era.period}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function TagOptions({
  tags,
  current,
  onPick,
}: {
  tags: { tag: string; count: number }[];
  current: string;
  onPick: (tag: string) => void;
}) {
  return (
    <ul role="listbox" className="grid grid-cols-2 gap-1.5">
      <li className="col-span-2">
        <button
          type="button"
          onClick={() => onPick("")}
          className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
            !current
              ? "bg-[var(--gold)]/15 text-[var(--gold-bright)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
          }`}
        >
          Tous les tags
        </button>
      </li>
      {tags.map((t) => (
        <li key={t.tag}>
          <button
            type="button"
            onClick={() => onPick(t.tag)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
              current === t.tag
                ? "bg-[var(--gold)]/15 text-[var(--gold-bright)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            }`}
          >
            <span className="truncate">#{t.tag}</span>
            <span className="ml-2 text-[10px] text-[var(--text-muted)]">{t.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function PlayerOptions({
  players,
  current,
  onPick,
}: {
  players: { slug: string; ign: string; role: string | null; count: number }[];
  current: string;
  onPick: (slug: string) => void;
}) {
  return (
    <ul role="listbox" className="space-y-1">
      <li>
        <button
          type="button"
          onClick={() => onPick("")}
          className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
            !current
              ? "bg-[var(--gold)]/15 text-[var(--gold-bright)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
          }`}
        >
          Tous les joueurs
        </button>
      </li>
      {players.map((p) => (
        <li key={p.slug}>
          <button
            type="button"
            onClick={() => onPick(p.slug)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
              current === p.slug
                ? "bg-[var(--gold)]/15 text-[var(--gold-bright)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
            }`}
          >
            <span className="font-semibold">{p.ign}</span>
            <span className="text-[10px] text-[var(--text-muted)]">
              {p.role ? p.role : ""} {p.count > 0 ? `· ${p.count}` : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function labelForEra(eraId: string): string {
  const era = ERAS.find((e) => e.id === eraId);
  return era?.label ?? "Epoque";
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
