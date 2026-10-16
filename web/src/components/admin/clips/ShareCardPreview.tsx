"use client";

import { useState } from "react";

/**
 * Aperçu de la carte de partage d'un clip (Discord / X / iMessage), avec
 * les mêmes titre, description et image que app/kill/[id] (generateMetadata) :
 *   titre       « Killer → Victime — KCKILLS »
 *   description ai_description, sinon le score
 *   image       /api/og/<id> (redirige vers og_image_url, sinon le visuel du site)
 * « Régénérer » met un job og.generate en file pour le worker.
 */
export function ShareCardPreview({
  killId,
  killer,
  victim,
  description,
  score,
  ogImageUrl,
}: {
  killId: string;
  killer: string | null;
  victim: string | null;
  description: string | null;
  score: number | null;
  ogImageUrl: string | null;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const title = `${killer ?? "?"} → ${victim ?? "?"} — KCKILLS`;
  const desc = description ?? `Highlight score ${score?.toFixed(1) ?? "?"}/10`;
  const provisional = /analyse IA en attente/i.test(desc);

  const regen = async () => {
    const r = await fetch(`/api/admin/clips/${killId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "og" }),
    });
    const d = (await r.json().catch(() => ({}))) as { error?: string; after?: { already_queued?: boolean } };
    setMsg(r.ok ? (d.after?.already_queued ? "Déjà en file." : "Régénération mise en file pour le worker.") : `Erreur : ${d.error}`);
  };

  return (
    <div className="space-y-2">
      <div className="max-w-sm overflow-hidden rounded-md border-l-4 border-[var(--gold)] bg-[#2b2d31] p-3 text-[13px] text-[#dbdee1]">
        <p className="text-[11px] text-[#b5bac1]">kckills.com</p>
        <p className="mt-0.5 font-semibold text-[#00a8fc]">{title}</p>
        <p className={`mt-1 line-clamp-3 text-[12px] ${provisional ? "text-[#f0b232]" : ""}`}>{desc}</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ogImageUrl ?? `/api/og/${killId}`} alt="Image de partage" className="mt-2 aspect-[1200/630] w-full rounded object-cover" loading="lazy" />
      </div>
      {provisional && <p className="text-[11px] text-[var(--orange)]">La description est provisoire : elle part telle quelle dans chaque partage.</p>}
      {!ogImageUrl && <p className="text-[11px] text-[var(--text-muted)]">Pas d&apos;image dédiée : le partage montre le visuel par défaut du site.</p>}
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void regen()} className="rounded-md border border-[var(--border-gold)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--gold)]">
          Régénérer l&apos;image
        </button>
        <a href={`/kill/${killId}`} target="_blank" rel="noreferrer" className="text-[11px] text-[var(--text-muted)] hover:text-[var(--gold)]">
          Page publique ↗
        </a>
        {msg && <span className="text-[11px] text-[var(--text-muted)]">{msg}</span>}
      </div>
    </div>
  );
}
