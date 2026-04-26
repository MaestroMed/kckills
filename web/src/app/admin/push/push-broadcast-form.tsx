"use client";

/**
 * Push composer (PR-loltok ED).
 *
 * Migrated to Agent EA's primitives + new <PushPreview /> mockup
 * (Agent ED). Adds icon URL + image URL inputs, a synchronous-send
 * confirm dialog, and toast feedback on every submit.
 */

import { useMemo, useState } from "react";
import { AdminButton } from "@/components/admin/ui/AdminButton";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { AdminSection } from "@/components/admin/ui/AdminSection";
import { PushPreview } from "@/components/admin/push/PushPreview";

const KINDS = [
  { id: "broadcast", label: "Broadcast", desc: "Annonce générale, événement, etc." },
  { id: "kill", label: "Clip", desc: "Highlight d'un kill spécifique." },
  { id: "kill_of_the_week", label: "KOTW", desc: "Kill of the Week (auto le dimanche)." },
  { id: "editorial_pin", label: "Pin éditorial", desc: "Notif d'un nouveau pin." },
  { id: "live_match", label: "Live", desc: "KC entre en game live." },
  { id: "system", label: "Système", desc: "Maintenance, downtime." },
] as const;

interface ToastMsg {
  id: number;
  text: string;
  tone: "success" | "error" | "info";
}

export function PushBroadcastForm({ subscriberCount }: { subscriberCount: number }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("broadcast");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("/scroll");
  const [iconUrl, setIconUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [killId, setKillId] = useState("");
  const [dedupeKey, setDedupeKey] = useState("");
  const [pending, setPending] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const sendNowDisabled = subscriberCount > 200;

  const pushToast = (text: string, tone: ToastMsg["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2800);
  };

  const submit = async (mode: "enqueue" | "send_now") => {
    if (mode === "send_now") {
      if (
        !confirm(
          `Envoyer cette notif MAINTENANT à ${subscriberCount.toLocaleString("fr-FR")} abonnés ? Cette action est synchrone et bloquera la page.`,
        )
      ) {
        return;
      }
    }
    setPending(true);
    try {
      const r = await fetch("/api/admin/push/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          kind,
          title: title.trim() || undefined,
          body: body.trim() || undefined,
          url: url.trim() || undefined,
          icon_url: iconUrl.trim() || undefined,
          image_url: imageUrl.trim() || undefined,
          kill_id: killId.trim() || undefined,
          dedupe_key: dedupeKey.trim() || undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        pushToast(`Erreur : ${data.error ?? `HTTP ${r.status}`}`, "error");
        return;
      }
      if (data.deduped) {
        pushToast("Déjà envoyé (dedupe key).", "info");
      } else if (mode === "send_now") {
        pushToast(
          `Envoyé. ${data.sent ?? 0} ok · ${data.failed ?? 0} fails · ${data.expired ?? 0} expirés.`,
        );
      } else {
        pushToast("Mis en file. Le worker enverra sous ~5 min.");
      }
      setTitle("");
      setBody("");
      setKillId("");
      setDedupeKey("");
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Erreur réseau", "error");
    } finally {
      setPending(false);
    }
  };

  const previewUrl = useMemo(() => url, [url]);

  return (
    <div className="space-y-5">
      <AdminCard variant="default" title="Composer">
        <div className="space-y-4">
          {/* Kind */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Type
            </label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKind(k.id)}
                  title={k.desc}
                  className={`rounded border px-2 py-1.5 text-xs transition-colors ${
                    kind === k.id
                      ? "border-[var(--gold)]/60 bg-[var(--gold)]/15 text-[var(--gold)]"
                      : "border-[var(--border-gold)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--gold)]/40"
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Titre <span className="opacity-60">(facultatif si kill_id fourni)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Caliste → Faker"
              className="mt-1 w-full rounded bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] border border-[var(--border-gold)] focus:border-[var(--gold)]/60 focus:outline-none"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Corps <span className="opacity-60">(facultatif si kill_id fourni)</span>
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={300}
              rows={3}
              placeholder="Outplay 1v2 dans la jungle adverse…"
              className="mt-1 w-full rounded bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] border border-[var(--border-gold)] focus:border-[var(--gold)]/60 focus:outline-none"
            />
          </div>

          {/* URL + kill_id */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                URL cible
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="/scroll"
                className="mt-1 w-full rounded bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] border border-[var(--border-gold)] focus:border-[var(--gold)]/60 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                kill_id <span className="opacity-60">(optionnel)</span>
              </label>
              <input
                type="text"
                value={killId}
                onChange={(e) => setKillId(e.target.value)}
                placeholder="uuid…"
                className="mt-1 w-full rounded bg-[var(--bg-elevated)] px-3 py-2 text-sm font-mono text-xs text-[var(--text-primary)] border border-[var(--border-gold)] focus:border-[var(--gold)]/60 focus:outline-none"
              />
            </div>
          </div>

          {/* Icon URL + Image URL */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                Icône URL <span className="opacity-60">(facultatif)</span>
              </label>
              <input
                type="text"
                value={iconUrl}
                onChange={(e) => setIconUrl(e.target.value)}
                placeholder="https://clips.kckills.com/icons/kc.png"
                className="mt-1 w-full rounded bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] border border-[var(--border-gold)] focus:border-[var(--gold)]/60 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                Image URL <span className="opacity-60">(grand visuel)</span>
              </label>
              <input
                type="text"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://clips.kckills.com/og/abc.png"
                className="mt-1 w-full rounded bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] border border-[var(--border-gold)] focus:border-[var(--gold)]/60 focus:outline-none"
              />
            </div>
          </div>

          {/* Dedupe */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              Dedupe key{" "}
              <span className="opacity-60">(idempotence — empêche un 2e envoi)</span>
            </label>
            <input
              type="text"
              value={dedupeKey}
              onChange={(e) => setDedupeKey(e.target.value)}
              placeholder="kotw:2026-w17"
              className="mt-1 w-full rounded bg-[var(--bg-elevated)] px-3 py-2 text-sm font-mono text-xs text-[var(--text-primary)] border border-[var(--border-gold)] focus:border-[var(--gold)]/60 focus:outline-none"
            />
          </div>

          {/* Submit */}
          <div className="flex items-center gap-2 pt-1">
            <AdminButton
              variant="primary"
              loading={pending}
              onClick={() => submit("enqueue")}
              fullWidth
            >
              Mettre en file ({subscriberCount.toLocaleString("fr-FR")} abonnés · ~5 min)
            </AdminButton>
            <AdminButton
              variant="danger"
              loading={pending}
              disabled={sendNowDisabled}
              onClick={() => submit("send_now")}
              title={sendNowDisabled ? "Trop d'abonnés pour un envoi synchrone (>200)" : undefined}
            >
              Envoyer MAINTENANT
            </AdminButton>
          </div>
        </div>
      </AdminCard>

      <AdminSection title="Aperçu" subtitle="Rendu approximatif sur iOS / Android / Chrome desktop">
        <PushPreview
          title={title}
          body={body}
          iconUrl={iconUrl || undefined}
          imageUrl={imageUrl || undefined}
          url={previewUrl}
        />
      </AdminSection>

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2 items-end pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`rounded-lg px-4 py-2 text-xs font-medium shadow-lg backdrop-blur-md ${
                t.tone === "success"
                  ? "bg-[var(--green)]/90 text-black"
                  : t.tone === "error"
                    ? "bg-[var(--red)]/90 text-white"
                    : "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-gold)]"
              }`}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
