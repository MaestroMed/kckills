/**
 * KillQuotesPanel — Server Component that renders the "PHRASES" list
 * attached to one kill, inside the /kill/[id] cinematic detail page.
 *
 * Fetches all visible quotes via fn_quotes_for_kill (RPC), maps them
 * into QuoteCardData and renders each as a <QuoteCard variant="inline">.
 * If there are zero quotes (worker hasn't reached this clip yet) the
 * panel returns null — the parent decides whether to surface a "empty"
 * placeholder.
 *
 * The clip_url plumbed into each card is the parent kill's
 * clip_url_vertical, so the audio button can stream a single track
 * regardless of how many quotes overlap.
 */

import { getQuotesForKill, type KillQuoteRow } from "@/lib/supabase/quotes";
import { QuoteCard, type QuoteCardData } from "./QuoteCard";

interface Props {
  killId: string;
  clipUrl: string | null;
  killerChampion: string | null;
  victimChampion: string | null;
  multiKill: string | null;
  isFirstBlood: boolean;
}

function toCardData(
  row: KillQuoteRow,
  context: Omit<Props, "killId">,
): QuoteCardData {
  return {
    id: row.id,
    kill_id: "",
    quote_text: row.quote_text,
    quote_start_ms: row.quote_start_ms,
    quote_end_ms: row.quote_end_ms,
    caster_name: row.caster_name,
    energy_level: row.energy_level,
    is_memetic: row.is_memetic,
    upvotes: row.upvotes,
    killer_champion: context.killerChampion,
    victim_champion: context.victimChampion,
    clip_url: context.clipUrl,
    multi_kill: context.multiKill,
    is_first_blood: context.isFirstBlood,
    match_date: null,
  };
}

export async function KillQuotesPanel(props: Props) {
  const rows = await getQuotesForKill(props.killId);
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 text-center text-sm text-[var(--text-muted)]">
        Pas encore de phrase culte extraite pour ce clip. L&apos;IA passe en
        revue les casters en continu — repasse bientot.
      </div>
    );
  }

  // Inject kill_id manually since the RPC doesn't return it (the kill
  // is implicit in fn_quotes_for_kill).
  const cards = rows.map((r) => ({
    ...toCardData(r, props),
    kill_id: props.killId,
  }));

  return (
    <section aria-labelledby="kill-quotes-heading" className="space-y-4">
      <header className="flex items-center justify-between">
        <h2
          id="kill-quotes-heading"
          className="font-display text-base md:text-lg uppercase tracking-widest text-[var(--gold)]"
        >
          ★ Phrases · {cards.length}
        </h2>
        <span className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          Extrait par IA
        </span>
      </header>
      <ul className="grid gap-3 grid-cols-1 md:grid-cols-2">
        {cards.map((c) => (
          <li key={c.id}>
            <QuoteCard quote={c} variant="inline" />
          </li>
        ))}
      </ul>
    </section>
  );
}
