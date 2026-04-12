import { type Quote } from "@/lib/quotes";

/**
 * Styled quote card with KC Hextech aesthetics.
 * Used on era pages, player pages, and homepage.
 */
export function QuoteCard({ quote }: { quote: Quote }) {
  return (
    <blockquote className="relative rounded-xl border-l-2 border-[var(--gold)]/40 bg-[var(--bg-surface)] px-6 py-5">
      {/* Gold accent quote mark */}
      <span className="absolute -top-2 left-4 font-display text-4xl text-[var(--gold)]/20 leading-none select-none">
        &ldquo;
      </span>
      <p className="text-sm md:text-base text-white/90 italic leading-relaxed">
        &laquo; {quote.text} &raquo;
      </p>
      <footer className="mt-3 flex items-center justify-between">
        <div>
          <cite className="font-display text-sm font-bold text-[var(--gold)] not-italic">
            {quote.author}
          </cite>
          <span className="text-[10px] text-[var(--text-muted)] ml-2">
            {quote.role}
          </span>
        </div>
        <span className="text-[9px] text-[var(--text-disabled)] italic">
          {quote.source}
          {quote.date && ` \u00b7 ${quote.date}`}
        </span>
      </footer>
    </blockquote>
  );
}

export function QuoteRow({ quotes }: { quotes: Quote[] }) {
  if (quotes.length === 0) return null;
  return (
    <div className="space-y-4">
      {quotes.map((q) => (
        <QuoteCard key={q.id} quote={q} />
      ))}
    </div>
  );
}
