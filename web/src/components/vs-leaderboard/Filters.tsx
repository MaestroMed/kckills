"use client";

/**
 * /vs/leaderboard — Filters bar.
 *
 * Sticky on desktop, fixed-bottom-sheet trigger on mobile. Five controls :
 *   - Role           segmented buttons (all / top / jgl / mid / bot / sup)
 *   - Champion       autocomplete dropdown of the champions currently on
 *                    the leaderboard
 *   - Era            dropdown of the 9 KC eras
 *   - Min batailles  slider 5..50
 *   - Active chips   inline pill list, click to remove
 *
 * Stateless — the parent owns `value` + `onChange`. We render the active
 * chip row when at least one filter is non-default, regardless of which
 * control surfaced it (keeps the UI cohesive across devices).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { m, AnimatePresence } from "motion/react";

import type { Era } from "@/lib/eras";

export interface LeaderboardFiltersValue {
  role: string | null;
  champion: string | null;
  eraId: string | null;
  eraDateStart: string | null;
  eraDateEnd: string | null;
  minBattles: number;
}

export const ROLE_TABS: Array<{ value: string | null; label: string; short: string }> = [
  { value: null, label: "Tous rôles", short: "Tous" },
  { value: "top", label: "Top", short: "Top" },
  { value: "jungle", label: "Jungle", short: "Jgl" },
  { value: "mid", label: "Mid", short: "Mid" },
  { value: "bottom", label: "Bot", short: "Bot" },
  { value: "support", label: "Support", short: "Sup" },
];

export const DEFAULT_FILTERS: LeaderboardFiltersValue = {
  role: null,
  champion: null,
  eraId: null,
  eraDateStart: null,
  eraDateEnd: null,
  minBattles: 5,
};

interface FiltersProps {
  value: LeaderboardFiltersValue;
  onChange: (next: LeaderboardFiltersValue) => void;
  champions: string[];
  eras: Era[];
  loading?: boolean;
  visibleCount: number;
}

// ════════════════════════════════════════════════════════════════════
// Root — sticky bar (desktop) + bottom-sheet (mobile)
// ════════════════════════════════════════════════════════════════════

export function Filters({
  value,
  onChange,
  champions,
  eras,
  loading,
  visibleCount,
}: FiltersProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const activeChips = useMemo(() => buildActiveChips(value, eras), [value, eras]);
  const filterCount = activeChips.length;

  const reset = useCallback(() => onChange(DEFAULT_FILTERS), [onChange]);

  return (
    <>
      {/* Desktop sticky bar (md+) */}
      <div
        className="hidden md:block sticky top-0 z-30 -mx-4 px-4 py-3 border-y border-[var(--border-gold)] bg-[var(--bg-primary)]/85 backdrop-blur-md"
        style={{
          boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        }}
      >
        <div className="mx-auto max-w-6xl flex items-center gap-3 flex-wrap">
          <RoleTabs value={value.role} onChange={(r) => onChange({ ...value, role: r })} />
          <Divider />
          <ChampionDropdown
            value={value.champion}
            onChange={(c) => onChange({ ...value, champion: c })}
            champions={champions}
          />
          <EraDropdown
            value={value.eraId}
            onChange={(eraId) => applyEra(eraId, eras, value, onChange)}
            eras={eras}
          />
          <BattlesSlider
            value={value.minBattles}
            onChange={(n) => onChange({ ...value, minBattles: n })}
          />
          <span className="ml-auto font-data text-[10px] uppercase tracking-[0.25em] text-white/45">
            {loading ? "Mise à jour…" : `${visibleCount} kill${visibleCount > 1 ? "s" : ""}`}
          </span>
          {filterCount > 0 && (
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-white/15 bg-black/30 px-2.5 py-1 font-data text-[10px] uppercase tracking-widest text-white/70 hover:border-white/40 hover:text-white transition-colors"
              aria-label="Réinitialiser tous les filtres"
            >
              Reset
            </button>
          )}
        </div>
        {activeChips.length > 0 && (
          <div className="mx-auto max-w-6xl mt-2 flex items-center gap-2 flex-wrap">
            <span className="font-data text-[9px] uppercase tracking-[0.3em] text-[var(--gold)]/55 mr-1">
              Filtres actifs
            </span>
            {activeChips.map((chip) => (
              <ActiveChip key={chip.key} chip={chip} onRemove={() => removeChip(chip.key, value, onChange)} />
            ))}
          </div>
        )}
      </div>

      {/* Mobile trigger (xs..md-1) */}
      <div className="md:hidden sticky top-0 z-30 -mx-3 px-3 py-2.5 border-y border-[var(--border-gold)] bg-[var(--bg-primary)]/90 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label="Ouvrir les filtres"
            className="flex items-center gap-2 rounded-xl border border-[var(--gold)]/40 bg-black/35 backdrop-blur-sm px-3.5 py-2 font-display text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--gold)]"
          >
            <span aria-hidden>◆</span>
            <span>Filtres</span>
            {filterCount > 0 && (
              <span className="rounded-full bg-[var(--gold)] text-[var(--bg-primary)] px-1.5 text-[10px] font-data font-black">
                {filterCount}
              </span>
            )}
          </button>
          <span className="ml-auto font-data text-[9px] uppercase tracking-[0.25em] text-white/45">
            {loading ? "Update…" : `${visibleCount} kills`}
          </span>
        </div>
        {activeChips.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            {activeChips.map((chip) => (
              <ActiveChip key={chip.key} chip={chip} onRemove={() => removeChip(chip.key, value, onChange)} compact />
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {sheetOpen && (
          <MobileSheet
            value={value}
            onChange={onChange}
            champions={champions}
            eras={eras}
            onClose={() => setSheetOpen(false)}
            onReset={reset}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// Role tabs
// ════════════════════════════════════════════════════════════════════

function RoleTabs({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Filtrer par rôle"
      className="inline-flex items-center rounded-xl border border-[var(--border-gold)] bg-black/25 p-1"
    >
      {ROLE_TABS.map((tab) => {
        const active = (tab.value ?? null) === (value ?? null);
        return (
          <button
            key={tab.label}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className="relative rounded-lg px-2.5 py-1 font-data text-[10px] uppercase tracking-[0.2em] transition-colors"
            style={{
              color: active ? "var(--bg-primary)" : "rgba(255,255,255,0.65)",
              background: active
                ? "linear-gradient(135deg, var(--gold-bright), var(--gold))"
                : "transparent",
              boxShadow: active ? "0 4px 12px rgba(200,170,110,0.35)" : "none",
            }}
          >
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.short}</span>
          </button>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Champion dropdown — searchable
// ════════════════════════════════════════════════════════════════════

function ChampionDropdown({
  value,
  onChange,
  champions,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  champions: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return champions.slice(0, 60);
    return champions.filter((c) => c.toLowerCase().includes(q)).slice(0, 60);
  }, [champions, query]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Filtrer par champion"
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-gold)] bg-black/25 px-3 py-1.5 font-data text-[10px] uppercase tracking-[0.2em] text-white/75 hover:border-[var(--gold)]/60 hover:text-white transition-colors"
      >
        <span aria-hidden>◇</span>
        <span>{value ?? "Tous champions"}</span>
        <span aria-hidden className="text-[var(--gold)]/70">▾</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Sélection champion"
          className="absolute left-0 top-full mt-2 z-40 w-64 rounded-xl border border-white/15 bg-[var(--bg-elevated)]/95 backdrop-blur-md shadow-2xl overflow-hidden"
        >
          <div className="p-2 border-b border-white/10">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Chercher un champion…"
              autoFocus
              aria-label="Filtrer la liste des champions"
              className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-1.5 text-xs text-white placeholder:text-white/35 focus:outline-none focus:border-[var(--gold)]/60"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full text-left px-3 py-1.5 text-xs text-white/80 hover:bg-white/5"
              >
                Tous champions
              </button>
            </li>
            {filtered.map((c) => (
              <li key={c} role="option" aria-selected={value === c}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5"
                  style={{
                    color: value === c ? "var(--gold)" : "rgba(255,255,255,0.85)",
                  }}
                >
                  {c}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-[10px] uppercase tracking-widest text-white/40">
                Aucun champion
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Era dropdown
// ════════════════════════════════════════════════════════════════════

function EraDropdown({
  value,
  onChange,
  eras,
}: {
  value: string | null;
  onChange: (eraId: string | null) => void;
  eras: Era[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const selectedEra = value ? eras.find((e) => e.id === value) ?? null : null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Filtrer par époque"
        className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-gold)] bg-black/25 px-3 py-1.5 font-data text-[10px] uppercase tracking-[0.2em] text-white/75 hover:border-[var(--gold)]/60 hover:text-white transition-colors"
      >
        <span
          aria-hidden
          className="inline-block"
          style={{
            width: 7,
            height: 7,
            transform: "rotate(45deg)",
            background: selectedEra?.color ?? "var(--gold)",
            boxShadow: `0 0 8px ${selectedEra?.color ?? "rgba(200,170,110,0.4)"}`,
          }}
        />
        <span>{selectedEra ? selectedEra.label : "Toutes époques"}</span>
        <span aria-hidden className="text-[var(--gold)]/70">▾</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Sélection époque"
          className="absolute left-0 top-full mt-2 z-40 w-72 rounded-xl border border-white/15 bg-[var(--bg-elevated)]/95 backdrop-blur-md shadow-2xl overflow-hidden"
        >
          <ul role="listbox" className="max-h-80 overflow-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-xs text-white/80 hover:bg-white/5"
              >
                Toutes époques
              </button>
            </li>
            {eras.map((era) => (
              <li key={era.id} role="option" aria-selected={value === era.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(era.id);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center gap-2.5"
                >
                  <span
                    aria-hidden
                    className="inline-block flex-shrink-0"
                    style={{
                      width: 9,
                      height: 9,
                      transform: "rotate(45deg)",
                      background: era.color,
                      boxShadow: `0 0 8px ${era.color}88`,
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className="block text-xs font-bold truncate"
                      style={{ color: value === era.id ? era.color : "rgba(255,255,255,0.85)" }}
                    >
                      {era.label}
                    </span>
                    <span className="block font-data text-[9px] uppercase tracking-widest text-white/40 truncate">
                      {era.period} · {era.phase}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Min battles slider
// ════════════════════════════════════════════════════════════════════

function BattlesSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-gold)] bg-black/25 px-3 py-1.5">
      <span className="font-data text-[10px] uppercase tracking-[0.2em] text-white/65">
        Min batailles
      </span>
      <input
        type="range"
        min={5}
        max={50}
        step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-24 accent-[var(--gold)]"
        aria-label="Nombre minimum de batailles"
      />
      <span className="font-data text-[11px] font-bold text-[var(--gold-bright)] tabular-nums w-6 text-right">
        {value}
      </span>
    </label>
  );
}

// ════════════════════════════════════════════════════════════════════
// Active chips
// ════════════════════════════════════════════════════════════════════

interface ActiveChip {
  key: "role" | "champion" | "era" | "minBattles";
  label: string;
  color?: string;
}

function buildActiveChips(value: LeaderboardFiltersValue, eras: Era[]): ActiveChip[] {
  const out: ActiveChip[] = [];
  if (value.role) {
    const tab = ROLE_TABS.find((r) => r.value === value.role);
    out.push({ key: "role", label: tab?.label ?? value.role });
  }
  if (value.champion) {
    out.push({ key: "champion", label: value.champion });
  }
  if (value.eraId) {
    const era = eras.find((e) => e.id === value.eraId);
    if (era) out.push({ key: "era", label: era.label, color: era.color });
  }
  if (value.minBattles > 5) {
    out.push({ key: "minBattles", label: `Min ${value.minBattles} batailles` });
  }
  return out;
}

function removeChip(
  key: ActiveChip["key"],
  value: LeaderboardFiltersValue,
  onChange: (next: LeaderboardFiltersValue) => void,
) {
  switch (key) {
    case "role":
      onChange({ ...value, role: null });
      break;
    case "champion":
      onChange({ ...value, champion: null });
      break;
    case "era":
      onChange({ ...value, eraId: null, eraDateStart: null, eraDateEnd: null });
      break;
    case "minBattles":
      onChange({ ...value, minBattles: 5 });
      break;
  }
}

function ActiveChip({
  chip,
  onRemove,
  compact,
}: {
  chip: ActiveChip;
  onRemove: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Retirer le filtre ${chip.label}`}
      className={`inline-flex items-center gap-1.5 rounded-full border bg-black/35 transition-colors hover:bg-black/55 ${
        compact ? "px-2 py-0.5" : "px-2.5 py-1"
      }`}
      style={{
        borderColor: chip.color ?? "rgba(200,170,110,0.45)",
        color: chip.color ?? "var(--gold)",
      }}
    >
      <span className={`font-data ${compact ? "text-[9px]" : "text-[10px]"} uppercase tracking-[0.2em] font-bold`}>
        {chip.label}
      </span>
      <span aria-hidden className="text-white/70">×</span>
    </button>
  );
}

function Divider() {
  return (
    <span
      aria-hidden
      className="hidden lg:inline-block w-px h-5 self-center"
      style={{
        background:
          "linear-gradient(180deg, transparent, rgba(200,170,110,0.4), transparent)",
      }}
    />
  );
}

// ════════════════════════════════════════════════════════════════════
// Mobile bottom sheet
// ════════════════════════════════════════════════════════════════════

function applyEra(
  eraId: string | null,
  eras: Era[],
  value: LeaderboardFiltersValue,
  onChange: (next: LeaderboardFiltersValue) => void,
) {
  if (!eraId) {
    onChange({ ...value, eraId: null, eraDateStart: null, eraDateEnd: null });
    return;
  }
  const era = eras.find((e) => e.id === eraId);
  if (!era) return;
  onChange({
    ...value,
    eraId,
    eraDateStart: era.dateStart,
    eraDateEnd: era.dateEnd,
  });
}

function MobileSheet({
  value,
  onChange,
  champions,
  eras,
  onClose,
  onReset,
}: {
  value: LeaderboardFiltersValue;
  onChange: (next: LeaderboardFiltersValue) => void;
  champions: string[];
  eras: Era[];
  onClose: () => void;
  onReset: () => void;
}) {
  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Filtres du classement"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <m.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-[var(--gold)]/30 bg-[var(--bg-surface)] p-5 max-h-[85vh] overflow-auto"
        style={{ boxShadow: "0 -20px 50px rgba(0,0,0,0.6)" }}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block"
              style={{
                width: 10,
                height: 10,
                transform: "rotate(45deg)",
                background: "linear-gradient(135deg, var(--gold-bright), var(--gold))",
              }}
            />
            <h2 className="font-display text-base font-black text-[var(--gold-bright)] uppercase tracking-[0.15em]">
              Filtres
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer les filtres"
            className="rounded-md border border-white/15 bg-black/30 px-3 py-1 font-data text-[10px] uppercase tracking-widest text-white/80 hover:border-white/40"
          >
            OK
          </button>
        </div>

        <SheetField label="Rôle">
          <RoleTabs value={value.role} onChange={(r) => onChange({ ...value, role: r })} />
        </SheetField>

        <SheetField label="Champion">
          <ChampionDropdown
            value={value.champion}
            onChange={(c) => onChange({ ...value, champion: c })}
            champions={champions}
          />
        </SheetField>

        <SheetField label="Époque">
          <EraDropdown
            value={value.eraId}
            onChange={(eraId) => applyEra(eraId, eras, value, onChange)}
            eras={eras}
          />
        </SheetField>

        <SheetField label={`Min batailles · ${value.minBattles}`}>
          <input
            type="range"
            min={5}
            max={50}
            step={1}
            value={value.minBattles}
            onChange={(e) => onChange({ ...value, minBattles: parseInt(e.target.value, 10) })}
            className="w-full accent-[var(--gold)]"
            aria-label="Nombre minimum de batailles"
          />
        </SheetField>

        <button
          type="button"
          onClick={() => {
            onReset();
            onClose();
          }}
          className="mt-4 w-full rounded-xl border border-white/20 bg-black/30 px-4 py-2.5 font-display text-xs font-bold uppercase tracking-[0.25em] text-white/80 hover:border-white/45"
        >
          Réinitialiser
        </button>
      </m.div>
    </m.div>
  );
}

function SheetField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <p className="font-data text-[9px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
        {label}
      </p>
      {children}
    </div>
  );
}
