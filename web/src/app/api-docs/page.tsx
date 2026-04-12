import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Documentation \u2014 KCKILLS",
  description: "Documentation de l'API publique KCKILLS pour acc\u00e9der aux kills, joueurs et matchs KC.",
};

export default function ApiDocsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 py-8">
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">Accueil</Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <span>API</span>
      </nav>

      <div>
        <h1 className="font-display text-3xl font-bold">
          API <span className="text-gold-gradient">Documentation</span>
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Endpoints publics pour acc&eacute;der aux kills, joueurs et matchs KC.
          CORS ouvert, cach&eacute;, gratuit.
        </p>
      </div>

      <Endpoint
        method="GET"
        path="/api/v1/kills"
        description="Liste des kills KC publi\u00e9s avec clips vid\u00e9o, scores et descriptions AI."
        params={[
          { name: "limit", type: "int", def: "20", desc: "Max results (1-100)" },
          { name: "offset", type: "int", def: "0", desc: "Pagination offset" },
          { name: "champion", type: "string", desc: "Filtrer par killer_champion (ex: Aurora)" },
          { name: "involvement", type: "string", desc: "team_killer ou team_victim" },
          { name: "sort", type: "string", def: "highlight_score", desc: "highlight_score, created_at, game_time_seconds" },
        ]}
        example="/api/v1/kills?limit=5&champion=Aurora&involvement=team_killer"
        response={`{
  "kills": [
    {
      "id": "uuid",
      "killer_champion": "Aurora",
      "victim_champion": "Bard",
      "clip_url_horizontal": "https://clips.kckills.com/...",
      "clip_url_vertical": "https://clips.kckills.com/...",
      "highlight_score": 8.5,
      "ai_description": "Aurora fait danser Bard...",
      "ai_tags": ["outplay", "solo_kill"],
      "multi_kill": null,
      "is_first_blood": false,
      ...
    }
  ],
  "count": 5,
  "offset": 0,
  "limit": 5
}`}
      />

      <Endpoint
        method="GET"
        path="/api/v1/players"
        description="Roster KC avec stats agr\u00e9g\u00e9es (KDA, games, champions)."
        params={[]}
        example="/api/v1/players"
        response={`{
  "players": [
    {
      "name": "Caliste",
      "role": "bottom",
      "games_played": 25,
      "total_kills": 127,
      "kda": 9.09,
      "top_champions": ["Ashe", "Jinx", ...]
    }
  ],
  "count": 5
}`}
      />

      <Endpoint
        method="GET"
        path="/api/v1/matches"
        description="Historique des matchs KC avec scores et r\u00e9sultats."
        params={[
          { name: "limit", type: "int", def: "20", desc: "Max results (1-100)" },
          { name: "year", type: "int", desc: "Filtrer par ann\u00e9e (2024, 2025, 2026)" },
        ]}
        example="/api/v1/matches?year=2026&limit=10"
        response={`{
  "matches": [
    {
      "id": "115548668059523724",
      "date": "2026-03-28",
      "opponent": { "code": "VIT", "name": "Team Vitality" },
      "kc_won": true,
      "kc_score": 2,
      "opp_score": 1,
      "total_kc_kills": 45,
      ...
    }
  ],
  "count": 10
}`}
      />

      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 text-center">
        <p className="text-sm text-[var(--text-muted)]">
          Tous les endpoints sont en lecture seule, CORS ouvert (*),
          et cach&eacute;s (60s kills, 1h players/matches).
        </p>
        <p className="mt-2 text-[10px] text-[var(--text-disabled)]">
          Rate limit: pas de limite explicite. Soyez raisonnables.
        </p>
      </div>
    </div>
  );
}

function Endpoint({
  method,
  path,
  description,
  params,
  example,
  response,
}: {
  method: string;
  path: string;
  description: string;
  params: { name: string; type: string; def?: string; desc: string }[];
  example: string;
  response: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
      <div className="flex items-center gap-3 border-b border-[var(--border-gold)] bg-[var(--bg-primary)] px-5 py-3">
        <span className="rounded-md bg-[var(--green)]/20 border border-[var(--green)]/40 px-2 py-0.5 text-[10px] font-bold text-[var(--green)]">
          {method}
        </span>
        <code className="font-data text-sm text-[var(--gold)]">{path}</code>
      </div>
      <div className="p-5 space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">{description}</p>

        {params.length > 0 && (
          <div>
            <p className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
              Param&egrave;tres
            </p>
            <div className="space-y-1">
              {params.map((p) => (
                <div key={p.name} className="flex items-baseline gap-2 text-xs">
                  <code className="font-data text-[var(--cyan)]">{p.name}</code>
                  <span className="text-[var(--text-disabled)]">({p.type})</span>
                  {p.def && <span className="text-[var(--text-muted)]">= {p.def}</span>}
                  <span className="text-[var(--text-secondary)]">&mdash; {p.desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)] mb-2">
            Exemple
          </p>
          <code className="block rounded-lg bg-[var(--bg-primary)] border border-[var(--border-gold)] px-4 py-2 font-data text-xs text-[var(--gold)] overflow-x-auto">
            {example}
          </code>
        </div>

        <details>
          <summary className="cursor-pointer font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--gold)]">
            R&eacute;ponse exemple
          </summary>
          <pre className="mt-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-gold)] p-4 font-data text-[11px] text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap">
            {response}
          </pre>
        </details>
      </div>
    </div>
  );
}
