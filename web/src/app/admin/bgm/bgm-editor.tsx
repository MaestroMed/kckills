"use client";

import { useState } from "react";
import type { BgmTrack } from "@/lib/scroll/bgm-playlist";

const GENRES: BgmTrack["genre"][] = ["synthwave", "trap", "edm", "dnb", "chill", "hype"];

export function BgmEditor({ initial }: { initial: BgmTrack[] }) {
  const [tracks, setTracks] = useState<BgmTrack[]>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add track form state
  const [newUrl, setNewUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newArtist, setNewArtist] = useState("");
  const [newGenre, setNewGenre] = useState<BgmTrack["genre"]>("synthwave");

  const extractYouTubeId = (url: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/, // raw ID
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  };

  const addTrack = () => {
    const id = extractYouTubeId(newUrl.trim());
    if (!id) {
      setError("URL YouTube invalide");
      return;
    }
    if (!newTitle.trim() || !newArtist.trim()) {
      setError("Titre + artiste requis");
      return;
    }
    setTracks((prev) => [
      ...prev,
      {
        id: `track_${Date.now()}`,
        title: newTitle.trim(),
        artist: newArtist.trim(),
        youtubeId: id,
        durationSeconds: 200,
        genre: newGenre,
      },
    ]);
    setNewUrl("");
    setNewTitle("");
    setNewArtist("");
    setError(null);
  };

  const removeTrack = (id: string) => {
    setTracks((prev) => prev.filter((t) => t.id !== id));
  };

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    setTracks((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const moveDown = (idx: number) => {
    setTracks((prev) => {
      if (idx === prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const r = await fetch("/api/bgm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tracks),
      });
      if (r.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        const data = await r.json();
        setError(data.error ?? "Erreur");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-black text-[var(--gold)]">BGM Playlist</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{tracks.length} tracks · NCS / royalty-free</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-[var(--gold)] px-4 py-2 text-sm font-bold text-black hover:bg-[var(--gold-bright)] disabled:opacity-50"
        >
          {saving ? "Sauvegarde..." : saved ? "✓ Sauvegardé" : "Sauvegarder"}
        </button>
      </header>

      {error && <p className="rounded-lg bg-[var(--red)]/10 border border-[var(--red)]/30 px-3 py-2 text-xs text-[var(--red)]">{error}</p>}

      {/* Tracks list */}
      <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] divide-y divide-[var(--border-gold)]/30">
        {tracks.length === 0 ? (
          <p className="p-6 text-center text-sm text-[var(--text-muted)]">Aucun track. Ajoute-en un ci-dessous.</p>
        ) : (
          tracks.map((track, idx) => (
            <div key={track.id} className="p-3 flex items-center gap-3">
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => moveUp(idx)}
                  disabled={idx === 0}
                  className="text-[10px] text-[var(--text-muted)] hover:text-[var(--gold)] disabled:opacity-20"
                  title="Monter"
                >
                  ▲
                </button>
                <button
                  onClick={() => moveDown(idx)}
                  disabled={idx === tracks.length - 1}
                  className="text-[10px] text-[var(--text-muted)] hover:text-[var(--gold)] disabled:opacity-20"
                  title="Descendre"
                >
                  ▼
                </button>
              </div>
              <span className="font-mono text-xs text-[var(--text-muted)] w-6">{idx + 1}.</span>
              {/* YouTube thumbnail */}
              <img
                src={`https://img.youtube.com/vi/${track.youtubeId}/default.jpg`}
                alt=""
                className="h-12 w-16 rounded object-cover"
              />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate">{track.title}</p>
                <p className="text-xs text-[var(--text-muted)] truncate">
                  {track.artist} · <span className="font-mono">{track.youtubeId}</span> · {track.genre}
                </p>
              </div>
              <a
                href={`https://www.youtube.com/watch?v=${track.youtubeId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--cyan)] hover:underline"
              >
                YouTube
              </a>
              <button
                onClick={() => removeTrack(track.id)}
                className="text-xs text-[var(--red)] hover:opacity-80 px-2"
              >
                Supprimer
              </button>
            </div>
          ))
        )}
      </section>

      {/* Add track */}
      <section className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 space-y-3">
        <h2 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          Ajouter un track
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            type="text"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="URL YouTube ou ID (11 chars)"
            className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-mono"
          />
          <select
            value={newGenre}
            onChange={(e) => setNewGenre(e.target.value as BgmTrack["genre"])}
            className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
          >
            {GENRES.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Titre (ex: Phoenix)"
            className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={newArtist}
            onChange={(e) => setNewArtist(e.target.value)}
            placeholder="Artiste (ex: Netrum & Halvorsen)"
            className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={addTrack}
          className="rounded-lg border border-[var(--gold)] px-4 py-2 text-sm font-bold text-[var(--gold)] hover:bg-[var(--gold)]/10"
        >
          + Ajouter
        </button>
      </section>

      <div className="rounded-lg border border-[var(--orange)]/30 bg-[var(--orange)]/5 p-3 text-xs text-[var(--text-muted)]">
        <p className="font-bold text-[var(--orange)] mb-1">⚠ Statut BGM Player</p>
        <p>
          Le player est désactivé temporairement (CSP bloque l&apos;URL Invidious).
          Pour le réactiver : héberger les MP3 sur R2 (clips.kckills.com est CSP-allowed)
          OU autoriser inv.nadeko.net dans le CSP.
        </p>
      </div>
    </div>
  );
}
