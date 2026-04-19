"use client";

import { useState, useCallback } from "react";

interface ReviewItem {
  id: string;
  killerChampion: string;
  victimChampion: string;
  clipHorizontal: string | null;
  clipVertical: string | null;
  thumbnail: string | null;
  aiDescription: string;
  aiTags: string[];
  fightType: string;
  highlightScore: number;
  multiKill: string | null;
  isFirstBlood: boolean;
  killVisible: boolean;
  kcInvolvement: string | null;
  gameTimeSeconds: number;
  gameNumber: number;
  matchStage: string;
}

const FIGHT_TYPES = [
  { value: "solo_kill", label: "Solo Kill (vrai 1v1)" },
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

export function ReviewEditor({ items }: { items: ReviewItem[] }) {
  const [idx, setIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editedCount, setEditedCount] = useState(0);

  // Editable fields (initialized from current item)
  const current = items[idx];
  const [desc, setDesc] = useState(current?.aiDescription ?? "");
  const [fightType, setFightType] = useState(current?.fightType ?? "solo_kill");
  const [tags, setTags] = useState<string[]>(current?.aiTags ?? []);
  const [score, setScore] = useState(current?.highlightScore ?? 5);
  const [hidden, setHidden] = useState(!current?.killVisible);

  const loadItem = useCallback((newIdx: number) => {
    const item = items[newIdx];
    if (!item) return;
    setIdx(newIdx);
    setDesc(item.aiDescription);
    setFightType(item.fightType);
    setTags([...item.aiTags]);
    setScore(item.highlightScore);
    setHidden(!item.killVisible);
    setSaved(false);
  }, [items]);

  const save = useCallback(async () => {
    if (!current) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/kills/${current.id}/edit`, {
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
      if (res.ok) {
        setSaved(true);
        setEditedCount((c) => c + 1);
      }
    } finally {
      setSaving(false);
    }
  }, [current, desc, fightType, tags, score, hidden]);

  const saveAndNext = useCallback(async () => {
    await save();
    if (idx < items.length - 1) loadItem(idx + 1);
  }, [save, idx, items.length, loadItem]);

  const toggleTag = (tag: string) => {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };

  if (!current) return <p className="p-8 text-center text-[var(--text-muted)]">Aucun clip.</p>;

  const gt = current.gameTimeSeconds;
  const gtStr = `${Math.floor(gt / 60)}:${(gt % 60).toString().padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-6xl py-6 px-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-[var(--gold)]">
          Backoffice Clips
        </h1>
        <div className="flex items-center gap-4">
          <span className="text-xs text-[var(--text-muted)]">{editedCount} modifies</span>
          <span className="font-data text-sm text-[var(--gold)]">
            {idx + 1} / {items.length}
          </span>
        </div>
      </div>

      {/* Navigation rapide */}
      <div className="flex gap-2">
        <button onClick={() => loadItem(Math.max(0, idx - 1))}
          className="rounded-lg border border-[var(--border-gold)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]">
          Precedent
        </button>
        <button onClick={() => loadItem(Math.min(items.length - 1, idx + 1))}
          className="rounded-lg border border-[var(--border-gold)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]">
          Suivant
        </button>
        <button onClick={() => loadItem(Math.min(items.length - 1, idx + 10))}
          className="rounded-lg border border-[var(--border-gold)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]">
          +10
        </button>
        <input
          type="number" min={1} max={items.length}
          value={idx + 1}
          onChange={(e) => loadItem(Math.max(0, Math.min(items.length - 1, Number(e.target.value) - 1)))}
          className="w-16 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-center text-[var(--text-primary)]"
        />
      </div>

      {/* Main layout: video + editor side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Video */}
        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--border-gold)] bg-black overflow-hidden">
            <video
              key={current.id}
              className="w-full aspect-video"
              src={current.clipHorizontal ?? current.clipVertical ?? undefined}
              poster={current.thumbnail ?? undefined}
              controls autoPlay muted playsInline preload="auto"
            />
          </div>
          <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
            <span className="font-display font-bold text-white">
              {current.killerChampion} &rarr; {current.victimChampion}
            </span>
            <span>{current.matchStage} G{current.gameNumber}</span>
            <span>T+{gtStr}</span>
            {current.multiKill && <span className="text-[var(--orange)]">{current.multiKill}</span>}
            {current.isFirstBlood && <span className="text-[var(--red)]">FB</span>}
            <span className="ml-auto font-mono text-[10px] opacity-50">{current.id.slice(0, 8)}</span>
          </div>
        </div>

        {/* Editor */}
        <div className="space-y-4">
          {/* Description */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Description
            </label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)] resize-none"
            />
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{desc.length} chars</p>
          </div>

          {/* Fight type */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Fight Type
            </label>
            <select
              value={fightType}
              onChange={(e) => setFightType(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)]"
            >
              {FIGHT_TYPES.map((ft) => (
                <option key={ft.value} value={ft.value}>{ft.label}</option>
              ))}
            </select>
          </div>

          {/* Highlight score */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Highlight Score: {score.toFixed(1)}/10
            </label>
            <input
              type="range" min={1} max={10} step={0.5} value={score}
              onChange={(e) => setScore(Number(e.target.value))}
              className="mt-1 w-full accent-[#C8AA6E]"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Tags ({tags.length})
            </label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {ALL_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold border transition-all ${
                    tags.includes(tag)
                      ? "bg-[var(--gold)]/20 border-[var(--gold)] text-[var(--gold)]"
                      : "bg-transparent border-[var(--border-gold)] text-[var(--text-disabled)] hover:text-[var(--text-muted)]"
                  }`}
                >
                  #{tag}
                </button>
              ))}
            </div>
          </div>

          {/* Hidden toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox" checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
              className="accent-[var(--red)]"
            />
            <span className="text-xs text-[var(--text-muted)]">
              Masquer ce clip du feed (kill pas visible / mauvaise qualite)
            </span>
          </label>

          {/* Save buttons */}
          <div className="flex gap-2 pt-2">
            <button onClick={save} disabled={saving}
              className="rounded-lg border border-[var(--gold)] px-4 py-2 text-sm font-bold text-[var(--gold)] hover:bg-[var(--gold)]/10 disabled:opacity-50 transition-all">
              {saving ? "..." : saved ? "Sauvegarde !" : "Sauvegarder"}
            </button>
            <button onClick={saveAndNext} disabled={saving}
              className="flex-1 rounded-lg bg-[var(--gold)] px-4 py-2 text-sm font-bold text-black hover:bg-[var(--gold-bright)] disabled:opacity-50 transition-all">
              {saving ? "..." : "Sauvegarder + Suivant"}
            </button>
          </div>

          {saved && (
            <p className="text-xs text-[var(--green)] text-center">Modifications sauvegardees en DB</p>
          )}
        </div>
      </div>
    </div>
  );
}
