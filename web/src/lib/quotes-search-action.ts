"use server";

/**
 * Server Action seam for the /quotes search field.
 *
 * Calls fn_search_quotes on the server (so the anon JWT and the
 * SECURITY DEFINER RPC do their thing) and reshapes the returned rows
 * into the QuoteCardData shape the client component expects.
 *
 * Returning a typed array directly is fine here — Next 15 supports
 * structured-clonable values across the action boundary, and rows are
 * pure JSON.
 */

import { searchQuotes } from "./supabase/quotes";
import type { QuoteCardData } from "@/components/quotes/QuoteCard";

export async function searchQuotesAction(
  query: string,
  limit = 50,
): Promise<QuoteCardData[]> {
  const rows = await searchQuotes(query, limit);
  return rows.map((r) => ({
    id: r.id,
    kill_id: r.kill_id,
    quote_text: r.quote_text,
    quote_start_ms: r.quote_start_ms,
    quote_end_ms: r.quote_end_ms,
    caster_name: r.caster_name,
    energy_level: r.energy_level,
    // fn_search_quotes doesn't return is_memetic — default false. The
    // search UI doesn't show the meme chip for matched rows, which is
    // fine : if the user is searching for a meme they already know
    // what they're looking for.
    is_memetic: false,
    upvotes: r.upvotes,
    killer_champion: r.killer_champion,
    victim_champion: r.victim_champion,
    clip_url: r.clip_url_vertical,
    multi_kill: r.multi_kill,
    is_first_blood: r.is_first_blood,
    match_date: null,
  }));
}
