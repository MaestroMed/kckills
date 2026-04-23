"use client";

/**
 * Push composer — kind picker, title, body, optional kill_id, mode.
 *
 * If a kill_id is provided, the API auto-fills title/body from the
 * kill row — leaving title empty is a valid workflow ("just send a
 * push for this clip").
 */

import { useState } from "react";

const KINDS = [
  { id: "broadcast", label: "Broadcast", desc: "Annonce générale, événement, etc." },
  { id: "kill", label: "Clip", desc: "Highlight d'un kill spécifique." },
  { id: "kill_of_the_week", label: "KOTW", desc: "Kill of the Week (auto le dimanche)." },
  { id: "editorial_pin", label: "Pin éditorial", desc: "Notif d'un nouveau pin." },
  { id: "live_match", label: "Live", desc: "KC entre en game live." },
  { id: "system", label: "Système", desc: "Maintenance, downtime." },
] as const;

export function PushBroadcastForm({ subscriberCount }: { subscriberCount: number }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("broadcast");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("/scroll");
  const [killId, setKillId] = useState("");
  const [dedupeKey, setDedupeKey] = useState("");
  const [mode, setMode] = useState<"enqueue" | "send_now">("enqueue");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendNowDisabled = subscriberCount > 200;

  const submit = async () => {
    setPending(true);
    setError(null);
    setResult(null);
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
          kill_id: killId.trim() || undefined,
          dedupe_key: dedupeKey.trim() || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? `HTTP ${r.status}`);
        return;
      }
      if (data.deduped) {
        setResult("Déjà envoyé (dedupe key).");
      } else if (mode === "send_now") {
        setResult(
          `Envoyé. ${data.sent ?? 0} ok, ${data.failed ?? 0} fails, ${data.expired ?? 0} expirés.`,
        );
      } else {
        setResult("Mis en file. Le worker enverra dans ~5 min.");
      }
      setTitle("");
      setBody("");
      setKillId("");
      setDedupeKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-4">
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
          placeholder="Outplay 1v2 dans la jungle adverse..."
          className="mt-1 w-full rounded bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] border border-[var(--border-gold)] focus:border-[var(--gold)]/60 focus:outline-none"
        />
      </div>

      {/* URL + kill_id + dedupe_key */}
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

      <div>
        <label className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          Dedupe key <span className="opacity-60">(idempotence — empêche un 2e envoi)</span>
        </label>
        <input
          type="text"
          value={dedupeKey}
          onChange={(e) => setDedupeKey(e.target.value)}
          placeholder="kotw:2026-w17"
          className="mt-1 w-full rounded bg-[var(--bg-elevated)] px-3 py-2 text-sm font-mono text-xs text-[var(--text-primary)] border border-[var(--border-gold)] focus:border-[var(--gold)]/60 focus:outline-none"
        />
      </div>

      {/* Mode */}
      <div>
        <label className="block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          Mode
        </label>
        <div className="mt-1.5 flex gap-1.5">
          <button
            type="button"
            onClick={() => setMode("enqueue")}
            className={`flex-1 rounded border px-2 py-1.5 text-xs transition-colors ${
              mode === "enqueue"
                ? "border-[var(--gold)]/60 bg-[var(--gold)]/15 text-[var(--gold)]"
                : "border-[var(--border-gold)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
            }`}
          >
            File d&apos;attente <span className="opacity-60">(~5 min)</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("send_now")}
            disabled={sendNowDisabled}
            className={`flex-1 rounded border px-2 py-1.5 text-xs transition-colors disabled:opacity-40 ${
              mode === "send_now"
                ? "border-[var(--gold)]/60 bg-[var(--gold)]/15 text-[var(--gold)]"
                : "border-[var(--border-gold)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
            }`}
            title={sendNowDisabled ? "Trop d'abonnés pour un envoi synchrone (>200)" : ""}
          >
            Envoyer maintenant
          </button>
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={submit}
        disabled={pending}
        className="w-full rounded-lg bg-[var(--gold)] px-4 py-2.5 text-sm font-bold text-black hover:bg-[var(--gold-bright)] disabled:opacity-50"
      >
        {pending ? "Envoi…" : `${mode === "send_now" ? "Envoyer" : "Mettre en file"} → ${subscriberCount.toLocaleString("fr-FR")} abonnés`}
      </button>

      {result && (
        <div className="rounded bg-[var(--green)]/10 px-3 py-2 text-xs text-[var(--green)]">
          {result}
        </div>
      )}
      {error && (
        <div className="rounded bg-[var(--red)]/10 px-3 py-2 text-xs text-[var(--red)]">
          {error}
        </div>
      )}
    </div>
  );
}
