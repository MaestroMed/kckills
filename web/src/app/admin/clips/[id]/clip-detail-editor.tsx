"use client";

import { useState } from "react";
import Link from "next/link";

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

interface Props {
  clip: any; // raw clip row
}

export function ClipDetailEditor({ clip }: Props) {
  const [desc, setDesc] = useState(clip.ai_description ?? "");
  const [fightType, setFightType] = useState(clip.fight_type ?? "solo_kill");
  const [tags, setTags] = useState<string[]>(clip.ai_tags ?? []);
  const [score, setScore] = useState<number>(clip.highlight_score ?? 5);
  const [hidden, setHidden] = useState<boolean>(clip.kill_visible === false);
  const [needsReclip, setNeedsReclip] = useState<boolean>(clip.needs_reclip ?? false);
  const [reclipReason, setReclipReason] = useState(clip.reclip_reason ?? "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const gt = clip.game_time_seconds ?? 0;
  const match = clip.games?.matches;
  const game = clip.games;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ai_description: desc,
          fight_type: fightType,
          ai_tags: tags,
          highlight_score: score,
          hidden,
          needs_reclip: needsReclip,
          reclip_reason: needsReclip ? reclipReason : null,
        }),
      });
      if (r.ok) {
        setSavedAt(new Date());
      } else {
        const e = await r.json();
        setError(e.error ?? "Erreur de sauvegarde");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setSaving(false);
    }
  };

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/clips" className="text-xs text-[var(--text-muted)] hover:text-[var(--gold)]">
            ← Retour à la library
          </Link>
          <h1 className="font-display text-xl font-bold mt-1">
            <span className="text-[var(--gold)]">{clip.killer_champion}</span>
            <span className="mx-2 text-[var(--text-muted)]">→</span>
            <span>{clip.victim_champion}</span>
          </h1>
          <p className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">{clip.id}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-[var(--text-muted)]">{match?.stage} G{game?.game_number}</p>
          <p className="text-xs text-[var(--text-muted)]">T+{Math.floor(gt / 60)}:{(gt % 60).toString().padStart(2, "0")}</p>
          <p className="text-[10px] text-[var(--text-disabled)]">{match?.scheduled_at?.slice(0, 10)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Video */}
        <div className="space-y-3">
          <div className="rounded-xl border border-[var(--border-gold)] bg-black overflow-hidden">
            <video
              key={clip.id}
              className="w-full aspect-video"
              src={clip.clip_url_horizontal ?? clip.clip_url_vertical ?? undefined}
              poster={clip.thumbnail_url ?? undefined}
              controls
              autoPlay
              muted
              playsInline
              preload="auto"
            />
          </div>

          {/* Metadata read-only */}
          <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3 space-y-2 text-xs">
            <h3 className="font-display text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Métadonnées</h3>
            <Field label="Status" value={clip.status} />
            <Field label="Tracked involvement" value={clip.tracked_team_involvement} />
            <Field label="Confidence" value={clip.confidence} />
            <Field label="Multi-kill" value={clip.multi_kill ?? "—"} />
            <Field label="First blood" value={clip.is_first_blood ? "✓" : "—"} />
            <Field label="Caster hype" value={clip.caster_hype_level ?? "—"} />
            <Field label="Lane phase" value={clip.lane_phase ?? "—"} />
            <Field label="Matchup lane" value={clip.matchup_lane ?? "—"} />
            <Field label="Champion class" value={clip.champion_class ?? "—"} />
            <Field label="Assistants" value={Array.isArray(clip.assistants) ? `${clip.assistants.length} (${clip.assistants.map((a: any) => a.champion).join(", ")})` : "—"} />
            <Field label="VOD" value={game?.vod_youtube_id ? `${game.vod_youtube_id} +${game.vod_offset_seconds}s` : "—"} />
            <Field label="Created" value={clip.created_at?.slice(0, 16).replace("T", " ")} />
            <Field label="Updated" value={clip.updated_at?.slice(0, 16).replace("T", " ")} />
            <Field label="Impressions" value={clip.impression_count} />
            <Field label="Ratings" value={`${clip.avg_rating?.toFixed(1) ?? "—"} (${clip.rating_count})`} />
            <Field label="Comments" value={clip.comment_count} />
          </div>
        </div>

        {/* Editor */}
        <div className="space-y-4">
          {/* Description */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] flex justify-between">
              <span>Description</span>
              <span className={desc.length < 40 ? "text-[var(--red)]" : "text-[var(--text-muted)]"}>{desc.length} chars</span>
            </label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)] resize-none"
            />
          </div>

          {/* Fight type */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Fight Type</label>
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

          {/* Score */}
          <div>
            <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] flex justify-between">
              <span>Highlight Score</span>
              <span className="font-mono text-[var(--gold)] font-bold">{score.toFixed(1)}/10</span>
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
            <div className="flex flex-wrap gap-1 mt-1">
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

          {/* Visibility */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="accent-[var(--red)]" />
            <span className="text-xs text-[var(--text-muted)]">Masquer du feed (kill_visible=false)</span>
          </label>

          {/* Needs reclip */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={needsReclip} onChange={(e) => setNeedsReclip(e.target.checked)} className="accent-[var(--orange)]" />
            <span className="text-xs text-[var(--text-muted)]">Marquer pour re-clip (le worker le reprendra)</span>
          </label>
          {needsReclip && (
            <input
              type="text"
              value={reclipReason}
              onChange={(e) => setReclipReason(e.target.value)}
              placeholder="Raison du re-clip..."
              className="w-full rounded-lg border border-[var(--orange)]/40 bg-[var(--bg-primary)] px-3 py-2 text-sm"
            />
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 rounded-lg bg-[var(--gold)] px-4 py-2.5 text-sm font-bold text-black hover:bg-[var(--gold-bright)] disabled:opacity-50"
            >
              {saving ? "Sauvegarde..." : "Sauvegarder"}
            </button>
            <Link href={`/kill/${clip.id}`} target="_blank" className="rounded-lg border border-[var(--border-gold)] px-4 py-2.5 text-sm text-[var(--text-muted)] hover:text-[var(--gold)]">
              Voir public
            </Link>
          </div>

          {savedAt && <p className="text-xs text-[var(--green)] text-center">✓ Sauvegardé à {savedAt.toLocaleTimeString("fr-FR")}</p>}
          {error && <p className="text-xs text-[var(--red)] text-center">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-mono text-[var(--text-primary)] truncate ml-2">{value ?? "—"}</span>
    </div>
  );
}
