"use client";

/**
 * Admin login — three paths (PR-loltok EE polish) :
 *   1. Email + password (Supabase Auth signInWithPassword)
 *      - Uses KCKILLS_ADMIN_EMAILS allowlist on the server
 *      - Multi-admin friendly, real per-person credentials
 *   2. Token (legacy — KCKILLS_ADMIN_TOKEN cookie)
 *   3. Discord OAuth (Supabase Auth signInWithOAuth)
 *      - Uses KCKILLS_ADMIN_DISCORD_IDS allowlist on the server
 *
 * The form lets the user pick the path that fits their setup. Auto-
 * redirects on success to ?from=… or /admin.
 *
 * Layout chrome — the parent /admin/layout.tsx already detects the
 * /admin/login pathname via x-pathname header and skips the sidebar +
 * topbar + auth gate. This page just renders the centered card.
 *
 * Easter egg : type the Konami code (↑↑↓↓←→←→ba) or "iddqd" anywhere
 * on the page (outside inputs) to trigger a "🐺 vibe maximale" floating
 * effect for 4s. Pure cosmetic, no backend impact.
 */

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { AdminButton } from "@/components/admin/ui/AdminButton";

const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

export function LoginForm({
  searchParamsPromise,
}: {
  searchParamsPromise?: Promise<{ from?: string; token?: string; next?: string }>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"email" | "token" | "signup">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [from, setFrom] = useState("/admin");
  const [vibe, setVibe] = useState(false);
  const konamiBuf = useRef<string[]>([]);
  const iddqdBuf = useRef<string>("");

  useEffect(() => {
    if (!searchParamsPromise) return;
    searchParamsPromise.then((sp) => {
      const target = sp?.next ?? sp?.from;
      if (target) setFrom(target);
      if (sp?.token) {
        setToken(sp.token);
        setMode("token");
      }
    });
  }, [searchParamsPromise]);

  // ─── Easter egg listeners ────────────────────────────────────────────
  useEffect(() => {
    function trigger() {
      setVibe(true);
      window.setTimeout(() => setVibe(false), 4000);
    }
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // Skip while user is typing credentials
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      )
        return;

      // Konami: track last KONAMI.length keys
      konamiBuf.current = [...konamiBuf.current, e.key].slice(-KONAMI.length);
      if (
        konamiBuf.current.length === KONAMI.length &&
        konamiBuf.current.every((k, i) => k.toLowerCase() === KONAMI[i].toLowerCase())
      ) {
        konamiBuf.current = [];
        trigger();
        return;
      }

      // "iddqd" word match — Doom god-mode cheat
      if (e.key.length === 1) {
        iddqdBuf.current = (iddqdBuf.current + e.key).slice(-5);
        if (iddqdBuf.current.toLowerCase() === "iddqd") {
          iddqdBuf.current = "";
          trigger();
        }
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const supabase =
    supabaseUrl && supabaseAnonKey
      ? createBrowserClient(supabaseUrl, supabaseAnonKey)
      : null;

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      if (!supabase) {
        setError("Supabase n'est pas configuré");
        return;
      }
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signErr) {
        setError(signErr.message);
        return;
      }
      router.push(from);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const submitSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      if (!supabase) {
        setError("Supabase n'est pas configuré");
        return;
      }
      const { error: signErr } = await supabase.auth.signUp({
        email,
        password,
      });
      if (signErr) {
        setError(signErr.message);
        return;
      }
      setInfo(
        "Compte créé. Vérifie ta boîte mail pour le lien de confirmation, puis demande à l'admin d'ajouter ton email à KCKILLS_ADMIN_EMAILS.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (r.ok) {
        router.push(from);
      } else {
        const data = await r.json().catch(() => ({}));
        setError(data.error ?? "Token invalide");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitDiscord = async () => {
    if (!supabase) {
      setError("Supabase n'est pas configuré");
      return;
    }
    setSubmitting(true);
    const { error: oauthErr } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: `${window.location.origin}${from}` },
    });
    if (oauthErr) {
      setError(oauthErr.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-6 bg-[var(--bg-primary)]">
      {/* Hextech ambient background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-[var(--gold)]/5 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[var(--blue-kc)]/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm space-y-5">
        {/* Logo + heading */}
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--gold)]/40 bg-[var(--bg-surface)] shadow-[0_0_24px_var(--gold)/15]">
            <span className="font-display text-3xl font-black text-[var(--gold)]">
              KC
            </span>
          </div>
          <h1 className="font-display text-2xl font-black text-[var(--gold)]">
            Backoffice KCKILLS
          </h1>
          <p className="text-[11px] uppercase tracking-widest text-[var(--text-muted)] mt-1">
            Admin Access
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6 space-y-4 shadow-2xl">
          {/* Mode tabs */}
          <div
            role="tablist"
            aria-label="Méthode de connexion"
            className="flex gap-1 text-[10px] uppercase tracking-widest border border-[var(--border-gold)] rounded-lg p-1"
          >
            {(["email", "signup", "token"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                  setInfo(null);
                }}
                className={`flex-1 py-1.5 rounded-md transition-colors ${
                  mode === m
                    ? "bg-[var(--gold)]/20 text-[var(--gold)]"
                    : "text-[var(--text-muted)] hover:text-white"
                }`}
              >
                {m === "email"
                  ? "Connexion"
                  : m === "signup"
                    ? "Inscription"
                    : "Token"}
              </button>
            ))}
          </div>

          {mode === "email" && (
            <form onSubmit={submitEmail} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                autoFocus
                required
                autoComplete="email"
                className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)]"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mot de passe"
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)]"
              />
              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-2 text-xs text-[var(--red)]"
                >
                  {error}
                </p>
              )}
              <AdminButton
                type="submit"
                fullWidth
                size="lg"
                variant="primary"
                disabled={submitting || !email.trim() || !password}
                loading={submitting}
              >
                Se connecter
              </AdminButton>
              <button
                type="button"
                onClick={submitDiscord}
                disabled={submitting}
                className="w-full rounded-lg border border-[#5865F2]/40 bg-[#5865F2]/10 py-2.5 text-sm font-bold text-[#5865F2] hover:bg-[#5865F2]/20 disabled:opacity-50 transition-colors"
              >
                <span aria-hidden="true">⌬</span> Continuer avec Discord
              </button>
            </form>
          )}

          {mode === "signup" && (
            <form onSubmit={submitSignup} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                autoFocus
                required
                autoComplete="email"
                className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)]"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mot de passe (8 chars min)"
                required
                autoComplete="new-password"
                minLength={8}
                className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)]"
              />
              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-2 text-xs text-[var(--red)]"
                >
                  {error}
                </p>
              )}
              {info && (
                <p
                  role="status"
                  className="rounded-lg border border-[var(--green)]/40 bg-[var(--green)]/10 px-3 py-2 text-xs text-[var(--green)]"
                >
                  {info}
                </p>
              )}
              <AdminButton
                type="submit"
                fullWidth
                size="lg"
                variant="primary"
                disabled={submitting || !email.trim() || password.length < 8}
                loading={submitting}
              >
                Créer un compte
              </AdminButton>
              <p className="text-[10px] text-[var(--text-muted)] text-center leading-relaxed">
                Après l&apos;inscription, demande à l&apos;admin d&apos;ajouter ton email à{" "}
                <code className="text-[var(--gold)]">KCKILLS_ADMIN_EMAILS</code>.
                Tu n&apos;auras pas accès tant que ce n&apos;est pas fait.
              </p>
            </form>
          )}

          {mode === "token" && (
            <form onSubmit={submitToken} className="space-y-3">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Admin token"
                required
                autoFocus
                className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)] font-mono"
              />
              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-2 text-xs text-[var(--red)]"
                >
                  {error}
                </p>
              )}
              <AdminButton
                type="submit"
                fullWidth
                size="lg"
                variant="primary"
                disabled={submitting || !token.trim()}
                loading={submitting}
              >
                Se connecter avec un token
              </AdminButton>
              <p className="text-[10px] text-[var(--text-muted)] text-center leading-relaxed">
                Token oublié ? Vérifie la variable d&apos;env{" "}
                <code className="text-[var(--gold)]">KCKILLS_ADMIN_TOKEN</code>{" "}
                sur Vercel.
              </p>
            </form>
          )}
        </div>

        <p className="text-center text-[10px] text-[var(--text-disabled)]">
          KCKILLS — Every kill. Rated. Remembered.
        </p>
      </div>

      {/* Easter egg vibe overlay */}
      {vibe && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center"
        >
          <div className="text-center animate-[vibePulse_4s_ease-out_forwards]">
            <p className="font-display text-7xl md:text-9xl font-black text-[var(--gold)] drop-shadow-[0_0_20px_var(--gold)]">
              🐺
            </p>
            <p className="mt-2 font-display text-2xl md:text-4xl font-black uppercase tracking-widest text-[var(--gold-bright)] drop-shadow-[0_0_12px_var(--gold)]">
              vibe maximale
            </p>
          </div>
          <style>{`
            @keyframes vibePulse {
              0%   { opacity: 0; transform: scale(0.5); }
              15%  { opacity: 1; transform: scale(1.1); }
              30%  { transform: scale(1); }
              80%  { opacity: 1; }
              100% { opacity: 0; transform: scale(1.4); }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
