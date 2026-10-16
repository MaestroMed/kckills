import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { adminPageDb } from "@/lib/admin/db";
import { GameCalibrator, type CalibKill } from "./game-calibrator";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Game — Admin", robots: { index: false, follow: false } };

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await adminPageDb();
  const { data: game } = await sb
    .from("games")
    .select(
      "id, external_id, game_number, match_id, vod_youtube_id, vod_offset_seconds, data_source, duration_seconds, " +
        "matches (external_id, stage, scheduled_at, team_blue_id, team_red_id, tournaments (name, year))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!game) notFound();
  const g = game as unknown as {
    id: string;
    external_id: string;
    game_number: number;
    match_id: string | null;
    vod_youtube_id: string | null;
    vod_offset_seconds: number | null;
    data_source: string | null;
    duration_seconds: number | null;
    matches: { stage: string | null; scheduled_at: string | null; team_blue_id: string | null; team_red_id: string | null; tournaments: { name: string | null; year: number | null } | null } | null;
  };

  const [{ data: kills }, { data: teams }, { data: siblings }] = await Promise.all([
    sb
      .from("kills")
      .select(
        "id, game_time_seconds, killer_champion, victim_champion, thumbnail_url, clip_url_vertical, kill_visible, needs_reclip, " +
          "publication_status, status, tracked_team_involvement, multi_kill",
      )
      .eq("game_id", id)
      .order("game_time_seconds", { ascending: true, nullsFirst: false })
      .limit(200),
    sb.from("teams").select("id, code"),
    g.match_id
      ? sb.from("games").select("id, game_number, vod_youtube_id, vod_offset_seconds").eq("match_id", g.match_id).order("game_number")
      : Promise.resolve({ data: [] as { id: string; game_number: number; vod_youtube_id: string | null; vod_offset_seconds: number | null }[] }),
  ]);
  const code = new Map((teams ?? []).map((t) => [t.id as string, t.code as string]));
  const m = g.matches;
  const title = `${code.get(m?.team_blue_id ?? "") ?? "?"} – ${code.get(m?.team_red_id ?? "") ?? "?"} · G${g.game_number}`;

  return (
    <div className="space-y-5">
      <header>
        <p className="text-[11px] text-[var(--text-muted)]">
          <Link href="/admin/games" className="hover:text-[var(--gold)]">Games</Link> ›{" "}
          {[m?.tournaments?.name, m?.tournaments?.year, m?.stage].filter(Boolean).join(" · ")}
          {m?.scheduled_at ? ` · ${new Date(m.scheduled_at).toLocaleDateString("fr-FR")}` : ""}
        </p>
        <h1 className="font-display text-2xl font-black text-[var(--gold)]">{title}</h1>
        <p className="font-mono text-[11px] text-[var(--text-disabled)]">{g.external_id} · source {g.data_source ?? "?"}</p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs">
        {(siblings ?? []).map((s) => (
          <Link
            key={s.id}
            href={`/admin/games/${s.id}`}
            className={`rounded-md border px-2.5 py-1 ${s.id === g.id ? "border-[var(--gold)] text-[var(--gold)]" : "border-[var(--border-gold)] text-[var(--text-secondary)] hover:text-[var(--gold)]"}`}
          >
            G{s.game_number} <span className="font-mono text-[10px] opacity-70">{s.vod_youtube_id ? `${s.vod_youtube_id.slice(0, 5)}…@${s.vod_offset_seconds ?? "?"}` : "sans VOD"}</span>
          </Link>
        ))}
      </div>

      <GameCalibrator
        gameId={g.id}
        vodId={g.vod_youtube_id}
        offset={g.vod_offset_seconds}
        kills={(kills ?? []) as unknown as CalibKill[]}
      />
    </div>
  );
}
