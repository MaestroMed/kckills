"use client";

import { useEffect, useState, useTransition } from "react";
import {
  DEFAULT_PLAYLISTS,
  type BgmTrack,
  type PlaylistId,
} from "@/lib/audio/playlists";
import { savePlaylists } from "./actions";

const PLAYLIST_LABELS: Record<PlaylistId, { label: string; subtitle: string; emoji: string }> = {
  homepage: {
    label: "Homepage",
    subtitle: "Vibe ambient / ramp-up sur la landing",
    emoji: "🌅",
  },
  scroll: {
    label: "Scroll feed",
    subtitle: "Vibe hype / montage sous le TikTok-style",
    emoji: "🔥",
  },
};

const GENRES: BgmTrack["genre"][] = [
  "synthwave",
  "trap",
  "edm",
  "dnb",
  "chill",
  "hype",
  "ambient",
  "anthemic",
];

interface State {
  homepage: BgmTrack[];
  scroll: BgmTrack[];
}

function emptyTrack(): BgmTrack {
  return {
    id: `track_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: "",
    artist: "",
    youtubeId: "",
    durationSeconds: 180,
    genre: "synthwave",
  };
}

function extractYoutubeId(input: string): string {
  // Accepts a raw videoId (11 chars) or a watch URL
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (match) return match[1];
  const short = trimmed.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (short) return short[1];
  return trimmed;
}

export function PlaylistsEditor() {
  const [state, setState] = useState<State>({
    homepage: DEFAULT_PLAYLISTS.homepage,
    scroll: DEFAULT_PLAYLISTS.scroll,
  });
  const [activeId, setActiveId] = useState<PlaylistId>("homepage");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Hydrate from server
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/playlists", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((data: { playlists: State }) => {
        if (cancelled) return;
        setState({
          homepage: Array.isArray(data?.playlists?.homepage)
            ? data.playlists.homepage
            : DEFAULT_PLAYLISTS.homepage,
          scroll: Array.isArray(data?.playlists?.scroll)
            ? data.playlists.scroll
            : DEFAULT_PLAYLISTS.scroll,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        // First-time load — no saved state yet, keep defaults
        if (String(e?.message) !== "404") {
          setError("Impossible de charger les playlists. Defaults affichés.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tracks = state[activeId];

  const updateTrack = (idx: number, patch: Partial<BgmTrack>) => {
    setState((prev) => ({
      ...prev,
      [activeId]: prev[activeId].map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    }));
  };

  const removeTrack = (idx: number) => {
    setState((prev) => ({
      ...prev,
      [activeId]: prev[activeId].filter((_, i) => i !== idx),
    }));
  };

  const addTrack = () => {
    setState((prev) => ({ ...prev, [activeId]: [...prev[activeId], emptyTrack()] }));
  };

  const moveTrack = (idx: number, direction: -1 | 1) => {
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= tracks.length) return;
    const copy = [...tracks];
    [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
    setState((prev) => ({ ...prev, [activeId]: copy }));
  };

  const save = () => {
    setSaving(true);
    setError(null);
    startTransition(async () => {
      try {
        const result = await savePlaylists(state);
        if (result.ok) {
          setSavedAt(Date.now());
        } else {
          setError(result.error ?? "Erreur de sauvegarde");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erreur action");
      } finally {
        setSaving(false);
      }
    });
  };

  if (loading) {
    return (
      <div className="text-sm text-[var(--text-muted)]">Chargement…</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Tab switcher ──────────────────────────────────────── */}
      <div className="flex gap-2 border-b border-[var(--border-gold)]">
        {(Object.keys(PLAYLIST_LABELS) as PlaylistId[]).map((id) => {
          const meta = PLAYLIST_LABELS[id];
          const isActive = id === activeId;
          return (
            <button
              key={id}
              onClick={() => setActiveId(id)}
              className={`
                px-4 py-2.5 -mb-px font-display text-base transition-colors border-b-2
                ${isActive
                  ? "text-[var(--gold-bright)] border-[var(--gold)]"
                  : "text-[var(--text-secondary)] border-transparent hover:text-[var(--gold)]"}
              `}
              aria-pressed={isActive}
            >
              {meta.emoji} {meta.label}
              <span className="ml-2 font-data text-[10px] text-[var(--text-muted)] tabular-nums">
                {state[id].length}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-[var(--text-muted)] -mt-4">
        {PLAYLIST_LABELS[activeId].subtitle}
      </p>

      {/* ─── Tracks list ───────────────────────────────────────── */}
      <div className="space-y-2">
        {tracks.map((track, idx) => (
          <div
            key={track.id}
            className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3 grid gap-2 md:grid-cols-[2.5fr_2fr_1.5fr_90px_70px_auto]"
          >
            <input
              type="text"
              value={track.title}
              onChange={(e) => updateTrack(idx, { title: e.target.value })}
              placeholder="Titre"
              className="rounded-md bg-black/30 border border-white/10 px-2 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none"
            />
            <input
              type="text"
              value={track.artist}
              onChange={(e) => updateTrack(idx, { artist: e.target.value })}
              placeholder="Artiste"
              className="rounded-md bg-black/30 border border-white/10 px-2 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none"
            />
            <input
              type="text"
              value={track.youtubeId}
              onChange={(e) =>
                updateTrack(idx, { youtubeId: extractYoutubeId(e.target.value) })
              }
              placeholder="YouTube ID ou URL"
              className="rounded-md bg-black/30 border border-white/10 px-2 py-1.5 font-mono text-xs text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none"
            />
            <input
              type="number"
              value={track.durationSeconds}
              onChange={(e) =>
                updateTrack(idx, {
                  durationSeconds: Math.max(1, parseInt(e.target.value, 10) || 0),
                })
              }
              placeholder="durée s"
              className="rounded-md bg-black/30 border border-white/10 px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none tabular-nums"
            />
            <select
              value={track.genre}
              onChange={(e) =>
                updateTrack(idx, { genre: e.target.value as BgmTrack["genre"] })
              }
              className="rounded-md bg-black/30 border border-white/10 px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none"
            >
              {GENRES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1 justify-end">
              <button
                type="button"
                onClick={() => moveTrack(idx, -1)}
                disabled={idx === 0}
                aria-label="Monter"
                className="w-7 h-7 grid place-items-center rounded-md hover:bg-white/5 text-[var(--text-secondary)] hover:text-[var(--gold)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveTrack(idx, 1)}
                disabled={idx === tracks.length - 1}
                aria-label="Descendre"
                className="w-7 h-7 grid place-items-center rounded-md hover:bg-white/5 text-[var(--text-secondary)] hover:text-[var(--gold)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeTrack(idx)}
                aria-label="Supprimer la piste"
                className="w-7 h-7 grid place-items-center rounded-md hover:bg-[var(--red)]/15 text-[var(--text-secondary)] hover:text-[var(--red)] transition-colors"
              >
                ×
              </button>
            </div>
          </div>
        ))}

        {tracks.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--border-gold)] p-6 text-center text-sm text-[var(--text-muted)]">
            Aucune piste pour cette playlist. Ajoute la première ↓
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={addTrack}
        className="px-3 py-2 rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/5 hover:bg-[var(--gold)]/15 text-sm text-[var(--gold-bright)] transition-all"
      >
        + Ajouter une piste
      </button>

      {/* ─── Save bar ──────────────────────────────────────────── */}
      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--gold)]/40 bg-black/60 backdrop-blur-xl px-4 py-3">
        <div className="text-xs text-[var(--text-muted)]">
          {error ? (
            <span className="text-[var(--red)]">⚠ {error}</span>
          ) : savedAt ? (
            <span className="text-[var(--green)]">
              ✓ Sauvegardé {Math.floor((Date.now() - savedAt) / 1000)}s
            </span>
          ) : (
            <span>Modifications non sauvegardées</span>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-bright)] text-[var(--bg-primary)] font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Sauvegarde…" : "Sauvegarder"}
        </button>
      </div>
    </div>
  );
}
