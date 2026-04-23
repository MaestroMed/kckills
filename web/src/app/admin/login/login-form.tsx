"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Admin login — three paths:
 *   1. Email + password (Supabase Auth signInWithPassword)
 *      - Uses KCKILLS_ADMIN_EMAILS allowlist on the server
 *      - Multi-admin friendly, real per-person credentials
 *   2. Token (legacy — KCKILLS_ADMIN_TOKEN cookie)
 *   3. Discord OAuth (Supabase Auth signInWithOAuth)
 *      - Uses KCKILLS_ADMIN_DISCORD_IDS allowlist on the server
 *
 * The form lets the user pick the path that fits their setup.
 */
export function LoginForm({ searchParamsPromise }: { searchParamsPromise?: Promise<{ from?: string; token?: string }> }) {
  const router = useRouter();
  const [mode, setMode] = useState<"email" | "token" | "signup">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [from, setFrom] = useState("/admin");

  useEffect(() => {
    if (!searchParamsPromise) return;
    searchParamsPromise.then((sp) => {
      if (sp?.from) setFrom(sp.from);
      if (sp?.token) {
        setToken(sp.token);
        setMode("token");
      }
    });
  }, [searchParamsPromise]);

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
        setError("Supabase not configured");
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
      // Cookie is set by Supabase. requireAdmin will check the email
      // against KCKILLS_ADMIN_EMAILS server-side.
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
        setError("Supabase not configured");
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
        "Account created. Check your email for a confirmation link, then ask the admin to add your email to KCKILLS_ADMIN_EMAILS.",
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
        const data = await r.json();
        setError(data.error ?? "Invalid token");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitDiscord = async () => {
    if (!supabase) {
      setError("Supabase not configured");
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
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6">
        <div className="text-center">
          <h1 className="font-display text-xl font-black text-[var(--gold)]">Admin Access</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">Backoffice KCKILLS</p>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 text-[10px] uppercase tracking-widest border border-[var(--border-gold)] rounded-lg p-1">
          {(["email", "signup", "token"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(null); setInfo(null); }}
              className={`flex-1 py-1.5 rounded-md transition-colors ${
                mode === m ? "bg-[var(--gold)]/20 text-[var(--gold)]" : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              {m === "email" ? "Sign in" : m === "signup" ? "Sign up" : "Token"}
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
              className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)]"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)]"
            />
            {error && <p className="text-xs text-[var(--red)]">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !email.trim() || !password}
              className="w-full rounded-lg bg-[var(--gold)] py-2.5 text-sm font-bold text-black hover:bg-[var(--gold-bright)] disabled:opacity-50"
            >
              {submitting ? "..." : "Sign in"}
            </button>
            <button
              type="button"
              onClick={submitDiscord}
              disabled={submitting}
              className="w-full rounded-lg border border-[#5865F2]/40 bg-[#5865F2]/10 py-2 text-sm font-bold text-[#5865F2] hover:bg-[#5865F2]/20 disabled:opacity-50"
            >
              Continue with Discord
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
              className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)]"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 8 chars)"
              required
              autoComplete="new-password"
              minLength={8}
              className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)]"
            />
            {error && <p className="text-xs text-[var(--red)]">{error}</p>}
            {info && <p className="text-xs text-[var(--green)]">{info}</p>}
            <button
              type="submit"
              disabled={submitting || !email.trim() || password.length < 8}
              className="w-full rounded-lg bg-[var(--gold)] py-2.5 text-sm font-bold text-black hover:bg-[var(--gold-bright)] disabled:opacity-50"
            >
              {submitting ? "..." : "Create account"}
            </button>
            <p className="text-[10px] text-[var(--text-muted)] text-center leading-relaxed">
              After signup, ask the admin to add your email to <code className="text-[var(--gold)]">KCKILLS_ADMIN_EMAILS</code>.
              You won&apos;t have access until then.
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
              className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)]"
            />
            {error && <p className="text-xs text-[var(--red)]">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !token.trim()}
              className="w-full rounded-lg bg-[var(--gold)] py-2.5 text-sm font-bold text-black hover:bg-[var(--gold-bright)] disabled:opacity-50"
            >
              {submitting ? "..." : "Sign in with token"}
            </button>
            <p className="text-[10px] text-[var(--text-muted)] text-center">
              Set <code className="text-[var(--gold)]">KCKILLS_ADMIN_TOKEN</code> env var on Vercel.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
