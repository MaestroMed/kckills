import Link from "next/link";
import type { Metadata } from "next";
import { adminPageDb } from "@/lib/admin/db";
import { loadAdminGames, type GameIssue } from "@/lib/admin/games";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Games — Admin", robots: { index: false, follow: false } };

const ISSUES: { id: GameIssue | "all"; label: string; hint: string }[] = [
  { id: "shared", label: "VOD partagée", hint: "même VOD au même offset qu'une autre game du match : une seule peut être juste" },
  { id: "unknown", label: "Offset inconnu", hint: "VOD YouTube connue, offset NULL ou 0. Les clips YouTube de ces games tombent dans le pré-show ; ceux clippés depuis Twitch (horloge du feed, depuis le 23/09) ne dépendent pas de cet offset : ouvre la game et regarde les vignettes avant de re-clipper" },
  { id: "novod", label: "Sans VOD", hint: "aucune VOD rattachée" },
  { id: "winner", label: "Sans vainqueur", hint: "game d'un match terminé sans vainqueur renseigné (stats et frise faussées)" },
  { id: "all", label: "Toutes", hint: "" },
];

const fmtOffset = (s: number | null) => {
  if (s == null) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
};

export default async function GamesPage({ searchParams }: { searchParams: Promise<{ issue?: string }> }) {
  const sp = await searchParams;
  const sb = await adminPageDb();
  const games = await loadAdminGames(sb);
  const issue = (ISSUES.find((i) => i.id === sp.issue)?.id ?? "unknown") as GameIssue | "all";
  const counts = Object.fromEntries(ISSUES.map((i) => [i.id, i.id === "all" ? games.length : games.filter((g) => g.issues.includes(i.id as GameIssue)).length]));
  const rows = games
    .filter((g) => issue === "all" || g.issues.includes(issue))
    .sort((a, b) => b.published - a.published || (b.date ?? "").localeCompare(a.date ?? ""));
  const publishedAffected = rows.reduce((n, g) => n + g.published, 0);
  const current = ISSUES.find((i) => i.id === issue)!;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-black text-[var(--gold)]">Games</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
          VOD et offset de chaque game. Un offset faux fausse tous les clips de la game : recale-le depuis la fiche de la game, puis marque
          ses clips à re-clipper.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {ISSUES.map((i) => (
          <Link
            key={i.id}
            href={`/admin/games?issue=${i.id}`}
            className={`rounded-full border px-3 py-1 text-xs ${issue === i.id ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)]" : "border-[var(--border-gold)] text-[var(--text-secondary)] hover:text-[var(--gold)]"}`}
          >
            {i.label} <span className="font-data tabular-nums opacity-70">{counts[i.id]}</span>
          </Link>
        ))}
      </nav>
      {current.hint && (
        <p className="text-xs text-[var(--text-muted)]">
          {current.hint}. {rows.length} game(s), {publishedAffected.toLocaleString("fr-FR")} clip(s) en ligne concernés.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              <th className="px-3 py-2 font-normal">Date</th>
              <th className="px-3 py-2 font-normal">Compétition</th>
              <th className="px-3 py-2 font-normal">Adversaire</th>
              <th className="px-3 py-2 font-normal">Game</th>
              <th className="px-3 py-2 font-normal">VOD @ offset</th>
              <th className="px-3 py-2 text-right font-normal">En ligne</th>
              <th className="px-3 py-2 text-right font-normal">À re-clipper</th>
              <th className="px-3 py-2 font-normal">Problèmes</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 400).map((g) => (
              <tr key={g.id} className="border-t border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]">
                <td className="px-3 py-1.5 whitespace-nowrap text-[var(--text-muted)]">{g.date ? new Date(g.date).toLocaleDateString("fr-FR") : "—"}</td>
                <td className="px-3 py-1.5 max-w-[16rem] truncate">{[g.tournament, g.stage].filter(Boolean).join(" · ") || "—"}</td>
                <td className="px-3 py-1.5 font-bold">{g.opponent ?? "?"}</td>
                <td className="px-3 py-1.5">
                  <Link href={`/admin/games/${g.id}`} className="text-[var(--gold)] hover:underline">G{g.game_number} →</Link>
                </td>
                <td className="px-3 py-1.5 font-mono text-[11px]">{g.vod_youtube_id ? `${g.vod_youtube_id} @ ${fmtOffset(g.vod_offset_seconds)}` : "—"}</td>
                <td className="px-3 py-1.5 text-right font-data tabular-nums">{g.published}</td>
                <td className="px-3 py-1.5 text-right font-data tabular-nums text-[var(--orange)]">{g.reclip || ""}</td>
                <td className="px-3 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {g.issues.map((i) => (
                      <span key={i} className="rounded bg-[var(--red)]/10 px-1.5 py-0.5 text-[10px] text-[var(--red)]">
                        {ISSUES.find((x) => x.id === i)?.label}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 400 && <p className="px-3 py-2 text-[11px] text-[var(--text-muted)]">400 premières affichées sur {rows.length}.</p>}
      </div>
    </div>
  );
}
