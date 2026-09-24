import type { Metadata } from "next";
import { LabClient } from "./LabClient";

// Page de travail (étendards, logo) : hors index, hors sitemap, hors menu.
export const metadata: Metadata = {
  title: "Labo",
  robots: { index: false, follow: false },
};

export default function LabPage() {
  return <LabClient />;
}
