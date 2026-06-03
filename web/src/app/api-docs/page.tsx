import Link from "next/link";
import type { Metadata } from "next";
import { getServerT } from "@/lib/i18n/server-lang";

export const metadata: Metadata = {
  title: "API Documentation",
  description: "Documentation de l'API publique KCKILLS pour acc\u00e9der aux kills, joueurs et matchs KC.",
};

export default async function ApiDocsPage() {
  const { t } = await getServerT();
  const endpointLabels = {
    params: t("p_pubpages.apidocs_label_params"),
    example: t("p_pubpages.apidocs_label_example"),
    response: t("p_pubpages.apidocs_label_response"),
  };
  return (
    <div className="mx-auto max-w-4xl space-y-8 py-8">
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">{t("p_pubpages.apidocs_breadcrumb_home")}</Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <span>{t("p_pubpages.apidocs_breadcrumb_current")}</span>
      </nav>

      <div>
        <h1 className="font-display text-3xl font-bold">
          API <span className="text-gold-gradient">Documentation</span>
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          {t("p_pubpages.apidocs_intro")}
        </p>
      </div>

      <Endpoint
        labels={endpointLabels}
        method="GET"
        path="/api/v1/kills"
        description={t("p_pubpages.apidocs_kills_desc")}
        params={[
          { name: "limit", type: "int", def: "20", desc: "Max results (1-100)" },
          { name: "offset", type: "int", def: "0", desc: "Pagination offset" },
          { name: "champion", type: "string", desc: t("p_pubpages.apidocs_kills_param_champion") },
          { name: "involvement", type: "string", desc: t("p_pubpages.apidocs_kills_param_involvement") },
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
        labels={endpointLabels}
        method="GET"
        path="/api/v1/players"
        description={t("p_pubpages.apidocs_players_desc")}
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
        labels={endpointLabels}
        method="GET"
        path="/api/v1/matches"
        description={t("p_pubpages.apidocs_matches_desc")}
        params={[
          { name: "limit", type: "int", def: "20", desc: "Max results (1-100)" },
          { name: "year", type: "int", desc: t("p_pubpages.apidocs_matches_param_year") },
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
          {t("p_pubpages.apidocs_footer_caching")}
        </p>
        <p className="mt-2 text-[10px] text-[var(--text-disabled)]">
          {t("p_pubpages.apidocs_footer_ratelimit")}
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
  labels,
}: {
  method: string;
  path: string;
  description: string;
  params: { name: string; type: string; def?: string; desc: string }[];
  example: string;
  response: string;
  labels: { params: string; example: string; response: string };
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
              {labels.params}
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
            {labels.example}
          </p>
          <code className="block rounded-lg bg-[var(--bg-primary)] border border-[var(--border-gold)] px-4 py-2 font-data text-xs text-[var(--gold)] overflow-x-auto">
            {example}
          </code>
        </div>

        <details>
          <summary className="cursor-pointer font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--gold)]">
            {labels.response}
          </summary>
          <pre className="mt-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-gold)] p-4 font-data text-[11px] text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap">
            {response}
          </pre>
        </details>
      </div>
    </div>
  );
}
