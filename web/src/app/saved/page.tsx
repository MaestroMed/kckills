import type { Metadata } from "next";
import { SavedClient } from "./saved-client";

/**
 * /saved — the user's bookmarked clips (Vague 2).
 *
 * The reading surface for the bookmark pipeline wired in Vague 1
 * (localStorage for anonymous visitors, kill_bookmarks via
 * /api/bookmarks for signed-in users). Client-rendered: the anonymous
 * source of truth lives in localStorage, which the server can't read.
 */
export const metadata: Metadata = {
  title: "Sauvegardés",
  robots: { index: false }, // personal surface — nothing to index
};

export default function SavedPage() {
  return <SavedClient />;
}
