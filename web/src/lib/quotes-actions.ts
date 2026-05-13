"use server";

/**
 * Server Action wrapper around the quote-upvote RPC.
 *
 * Client component (<QuoteCard />) calls this with the session hash it
 * mints + persists in localStorage. The server reaches out to Supabase
 * using the request-scoped server client so we don't leak the service
 * role key into the browser bundle.
 *
 * The actual RPC call lives in lib/supabase/quotes.ts which is
 * server-only ; this file is the public Server Action seam.
 */

import { recordQuoteUpvote } from "./supabase/quotes";

export async function upvoteQuoteAction(
  quoteId: string,
  sessionHash: string,
): Promise<{ upvotes: number; alreadyVoted: boolean }> {
  if (typeof quoteId !== "string" || typeof sessionHash !== "string") {
    return { upvotes: 0, alreadyVoted: true };
  }
  // Light input shape check : the migration RPC bails if hash < 8 chars,
  // we mirror that early so we don't burn a network round-trip.
  if (quoteId.length < 8 || sessionHash.length < 16) {
    return { upvotes: 0, alreadyVoted: true };
  }
  return recordQuoteUpvote(quoteId, sessionHash);
}
