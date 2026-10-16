"use client";

import { useRef, useState } from "react";

/**
 * Choix de la vignette d'un clip : on parcourt la vidéo verticale, on
 * fige l'image voulue, elle part sur R2 et remplace thumbnail_url (poster
 * du feed). Utile pour les ~300 clips dont la vignette automatique est un
 * volet de transition (audit du 29/09).
 *
 * La capture lit les pixels de la vidéo : il faut que R2 réponde avec les
 * en-têtes CORS pour l'origine du site (règle posée le 08/10 sur
 * kckills-clips) — sinon le navigateur bloque la lecture du canvas.
 */
export function ThumbnailPicker({ killId, videoUrl, current }: { killId: string; videoUrl: string | null; current: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [preview, setPreview] = useState<string | null>(current);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!videoUrl) return <p className="text-xs text-[var(--text-muted)]">Pas de clip vertical.</p>;

  const capture = async () => {
    const v = ref.current;
    if (!v || !v.videoWidth) return;
    setBusy(true);
    setMsg(null);
    try {
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.88));
      if (!blob) throw new Error("capture impossible");
      const r = await fetch(`/api/admin/clips/${killId}/thumbnail?t=${v.currentTime.toFixed(2)}`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      const d = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setPreview(d.url ?? null);
      setMsg({ text: "Vignette remplacée.", ok: true });
    } catch (e) {
      const m = (e as Error).message;
      setMsg({ text: /tainted|insecure|SecurityError/i.test(m) ? "Le navigateur bloque la capture (CORS de R2 pour cette origine)." : `Erreur : ${m}`, ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-3">
      <div className="w-40 shrink-0 space-y-2">
        <video ref={ref} src={videoUrl} crossOrigin="anonymous" muted playsInline controls preload="auto" className="aspect-[9/16] w-full rounded-md bg-black object-cover" />
        <button type="button" onClick={() => void capture()} disabled={busy} className="w-full rounded-md border border-[var(--gold)]/50 bg-[var(--gold)]/10 px-2 py-1.5 text-[11px] font-bold text-[var(--gold)] disabled:opacity-40">
          {busy ? "Envoi…" : "Utiliser cette image"}
        </button>
      </div>
      <div className="space-y-1.5 text-[11px] text-[var(--text-muted)]">
        <p>Mets la vidéo sur pause à l&apos;image voulue, puis valide.</p>
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Vignette actuelle" className="aspect-[9/16] w-24 rounded-md object-cover" />
        )}
        {msg && <p className={msg.ok ? "text-[var(--green)]" : "text-[var(--red)]"}>{msg.text}</p>}
      </div>
    </div>
  );
}
