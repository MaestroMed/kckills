"use client";

import { useEffect, useState } from "react";

interface ClipDetail {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  game_time_seconds: number | null;
  highlight_score: number | null;
  ai_description: string | null;
  ai_tags: string[];
  multi_kill: string | null;
  is_first_blood: boolean;
  kill_visible: boolean | null;
  fight_type: string | null;
  clip_url_vertical: string | null;
  clip_url_horizontal: string | null;
  thumbnail_url: string | null;
}

const FIGHT_TYPES = [
  { value: "solo_kill", label: "Solo Kill" },
  { value: "pick", label: "Pick (2v1)" },
  { value: "gank", label: "Gank (3v1+)" },
  { value: "skirmish_2v2", label: "Skirmish 2v2" },
  { value: "skirmish_3v3", label: "Skirmish 3v3" },
  { value: "teamfight_4v4", label: "Teamfight 4v4" },
  { value: "teamfight_5v5", label: "Teamfight 5v5" },
];

const ALL_TAGS = [
  "outplay", "teamfight", "solo_kill", "tower_dive", "baron_fight",
  "dragon_fight", "flash_predict", "1v2", "1v3", "clutch", "clean",
  "mechanical", "shutdown", "comeback", "engage", "peel", "snipe",
  "steal", "skirmish", "pick", "gank", "ace", "flank",
];

export function ClipDetailDrawer({
  clipId,
  onClose,
  onSaved,
  onPrev,
  onNext,
}: {
  clipId: string | null;
  onClose: () => void;
  onSaved?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const [clip, setClip] = useState<ClipDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [desc, setDesc] = useState("");
  const [fightType, setFightType] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [score, setScore] = useState(5);
  const [hidden, setHidden] = useState(false);

  // Load clip when ID changes
  useEffect(() => {
    if (!clipId) return;
    setLoading(true);
    setSaved(false);
    fetch(`/api/admin/clips/${clipId}`)
      .then((r) => r.json())
      .then((data: ClipDetail) => {
        setClip(data);
        setDesc(data.ai_description ?? "");
        setFightType(data.fight_type ?? "solo_kill");
        setTags(data.ai_tags ?? []);
        setScore(data.highlight_score ?? 5);
        setHidden(data.kill_visible === false);
      })
      .catch(() => setClip(null))
      .finally(() => setLoading(false));
  }, [clipId]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!clipId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "j" && onNext) onNext();
      if (e.key === "k" && onPrev) onPrev();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, onNext, onPrev]);

  const save = async () => {
    if (!clip) return;
    setSaving(true);
    setSaved(false);
    try {
      const r = await fetch(`/api/kills/${clip.id}/edit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ai_description: desc,
          fight_type: fightType,
          ai_tags: tags,
          highlight_score: score,
          hidden,
        }),
      });
      if (r.ok) {
        setSaved(true);
        onSaved?.();
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleTag = (t: string) => {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  if (!clipId) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <aside className="fixed right-0 top-0 bottom-0 w-full max-w-2xl bg-[var(--bg-surface)] border-l border-[var(--border-gold)] z-50 overflow-y-auto">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-[var(--bg-surface)] border-b border-[var(--border-gold)] flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            {onPrev && (
              <button onClick={onPrev} className="text-[var(--text-muted)] hover:text-[var(--gold)] px-2 text-lg" title="Précédent (K)">‹</button>
            )}
            {onNext && (
              <button onClick={onNext} className="text-[var(--text-muted)] hover:text-[var(--gold)] px-2 text-lg" title="Suivant (J)">›</button>
            )}
            <h2 className="font-display text-sm font-bold text-[var(--gold)]">
              {clip ? `${clip.killer_champion} → ${clip.victim_champion}` : "Loading..."}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {saved && <span className="text-[var(--green)] text-xs">✓ Sauvegardé</span>}
            <button onClick={onClose} className="text-2xl text-[var(--text-muted)] hover:text-[var(--gold)]" title="Fermer (Esc)">×</button>
          </div>
        </header>

        {loading && <p className="p-6 text-center text-[var(--text-muted)]">Chargement...</p>}

        {clip && !loading && (
          <div className="p-4 space-y-4">
            {/* Video player */}
            <video
              key={clip.id}
              className="w-full aspect-video rounded-lg bg-black"
              src={clip.clip_url_horizontal ?? clip.clip_url_vertical ?? undefined}
              poster={clip.thumbnail_url ?? undefined}
              controls
              autoPlay
              muted
              playsInline
              preload="auto"
            />

            {/* Metadata */}
            <div className="text-xs text-[var(--text-muted)] flex gap-3">
              <span>T+{Math.floor((clip.game_time_seconds ?? 0) / 60)}:{((clip.game_time_seconds ?? 0) % 60).toString().padStart(2, "0")}</span>
              {clip.multi_kill && <span className="text-[var(--orange)]">{clip.multi_kill}</span>}
              {clip.is_first_blood && <span className="text-[var(--red)]">First Blood</span>}
              <span className="ml-auto font-mono opacity-60">{clip.id.slice(0, 8)}</span>
            </div>

            {/* Description */}
            <div>
              <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Description</label>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm resize-none"
              />
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{desc.length} chars</p>
            </div>

            {/* Fight type + score */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Fight type</label>
                <select
                  value={fightType}
                  onChange={(e) => setFightType(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
                >
                  {FIGHT_TYPES.map((ft) => (
                    <option key={ft.value} value={ft.value}>{ft.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Score: {score.toFixed(1)}</label>
                <input
                  type="range" min={1} max={10} step={0.5} value={score}
                  onChange={(e) => setScore(Number(e.target.value))}
                  className="mt-2 w-full accent-[#C8AA6E]"
                />
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Tags ({tags.length})</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {ALL_TAGS.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold border transition-all ${
                      tags.includes(t)
                        ? "bg-[var(--gold)]/20 border-[var(--gold)] text-[var(--gold)]"
                        : "bg-transparent border-[var(--border-gold)] text-[var(--text-disabled)] hover:text-[var(--text-muted)]"
                    }`}
                  >
                    #{t}
                  </button>
                ))}
              </div>
            </div>

            {/* Hidden toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="accent-[var(--red)]" />
              <span className="text-xs text-[var(--text-muted)]">Masquer du feed (kill pas visible / mauvaise qualité)</span>
            </label>

            {/* Save buttons */}
            <div className="flex gap-2 pt-2 sticky bottom-0 bg-[var(--bg-surface)] -mx-4 px-4 pb-3 border-t border-[var(--border-gold)] mt-4">
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 rounded-lg bg-[var(--gold)] px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50"
              >
                {saving ? "..." : "Sauvegarder (Ctrl+Enter)"}
              </button>
              {onNext && (
                <button onClick={async () => { await save(); onNext(); }}
                  className="rounded-lg border border-[var(--gold)] px-4 py-2.5 text-sm font-bold text-[var(--gold)]">
                  Sauver + Suivant ›
                </button>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
