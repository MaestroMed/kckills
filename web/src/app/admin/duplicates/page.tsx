import type { Metadata } from "next";
import { adminPageDb } from "@/lib/admin/db";
import { findDuplicatePairs } from "@/lib/admin/duplicates";
import { DuplicateResolver } from "./duplicate-resolver";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Doublons — Admin", robots: { index: false, follow: false } };

export default async function DuplicatesPage() {
  const sb = await adminPageDb();
  const pairs = await findDuplicatePairs(sb);
  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-black text-[var(--gold)]">Doublons</h1>
        <p className="mt-1 max-w-3xl text-xs text-[var(--text-muted)]">
          Clips en ligne du même jour de match et du même numéro de game, avec le même tueur et la même victime, à moins de 15 s d&apos;écart.{" "}
          {pairs.length} paire(s). Garder un clip retire l&apos;autre du feed ; ses anciens liens mènent au clip gardé. Annulable depuis le
          journal admin.
        </p>
      </header>
      <DuplicateResolver pairs={pairs} />
    </div>
  );
}
