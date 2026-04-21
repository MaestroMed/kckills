"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ searchParamsPromise }: { searchParamsPromise?: Promise<{ from?: string; token?: string }> }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [from, setFrom] = useState("/admin");

  // Read searchParams once
  useEffect(() => {
    if (!searchParamsPromise) return;
    searchParamsPromise.then((sp) => {
      if (sp?.from) setFrom(sp.from);
      if (sp?.token) setToken(sp.token);
    });
  }, [searchParamsPromise]);

  const submit = async (e: React.FormEvent) => {
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

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-6"
      >
        <div className="text-center">
          <h1 className="font-display text-xl font-black text-[var(--gold)]">Admin Access</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">Backoffice KCKILLS</p>
        </div>

        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Admin token"
          autoFocus
          required
          className="w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)]"
        />

        {error && <p className="text-xs text-[var(--red)]">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !token.trim()}
          className="w-full rounded-lg bg-[var(--gold)] py-2.5 text-sm font-bold text-black hover:bg-[var(--gold-bright)] disabled:opacity-50"
        >
          {submitting ? "..." : "Sign in"}
        </button>

        <p className="text-[10px] text-[var(--text-muted)] text-center">
          Set <code className="text-[var(--gold)]">KCKILLS_ADMIN_TOKEN</code> env var on Vercel.
        </p>
      </form>
    </div>
  );
}
