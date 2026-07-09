import type { Metadata } from "next";

// Wave 38.2 — /login is a "use client" page and can't export metadata;
// this server layout carries it. noindex keeps the OAuth entry point out
// of Google (it also indexed under the site-wide default title with no
// canonical). The sitemap entry was dropped in the same wave.
export const metadata: Metadata = {
  title: "Connexion",
  robots: { index: false, follow: true },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
