"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { championLoadingUrl } from "@/lib/constants";
import { Breadcrumb } from "@/components/Breadcrumb";

/**
 * /login — Discord OAuth entry point.
 *
 * Features:
 *   - Cinematic hero with champion splash backdrop (Jhin — the "marksman
 *     who sees the art in every kill" fits the brand).
 *   - `returnTo` query param: if set, the OAuth callback will redirect
 *     back to that path after success. Used by places like the /scroll
 *     rate button that prompt login mid-action.
 *   - Auto-redirect when already logged in (checks on mount).
 *   - Loading state on the button during the OAuth round-trip.
 *   - Error toast if Supabase returns an error.
 */

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") || "/";

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // If the user is already logged in, skip the page entirely.
  useEffect(() => {
    const sb = createSupabaseBrowser();
    sb.auth
      .getUser()
      .then(({ data }) => {
        if (data.user) {
          // Already authenticated — respect returnTo
          router.replace(returnTo);
          return;
        }
        setCheckingSession(false);
      })
      .catch(() => setCheckingSession(false));
  }, [router, returnTo]);

  const handleDiscordLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowser();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "discord",
        options: {
          // Forward returnTo through the callback so the session bounce
          // lands the user where they started.
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnTo)}`,
        },
      });
      if (authError) {
        setError(authError.message);
        setLoading(false);
      }
      // On success, browser navigates to Discord's OAuth — this component unmounts.
    } catch (e) {
      setError((e as Error).message || "Erreur inconnue");
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--gold)] border-t-transparent" />
      </div>
    );
  }

  return (
    <div
      className="-mt-6"
      style={{
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      {/* ─── HERO ─────────────────────────────────────────────────── */}
      <section className="relative min-h-[calc(100vh-4rem)] overflow-hidden flex items-center">
        {/* Champion splash backdrop */}
        <Image
          src={championLoadingUrl("Jhin")}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
          style={{ filter: "brightness(0.18) saturate(1.1)" }}
        />
        {/* Gold radial + gradient fade */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 50% 50% at 50% 50%, rgba(200,170,110,0.2) 0%, transparent 65%)",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--bg-primary)]/40 via-transparent to-[var(--bg-primary)]" />
        {/* Scanlines */}
        <div
          className="absolute inset-0 opacity-12 mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.1) 3px, transparent 4px)",
          }}
        />

        <div className="relative z-10 max-w-7xl mx-auto w-full px-6 py-16">
          <Breadcrumb
            items={[
              { label: "Accueil", href: "/" },
              { label: "Connexion" },
            ]}
          />

          <div className="mt-10 grid md:grid-cols-2 gap-12 items-center">
            {/* Left — copy */}
            <div>
              <p className="font-data text-[10px] uppercase tracking-[0.35em] text-[var(--gold)]/70 mb-4">
                ◆ Discord OAuth
              </p>
              <h1 className="font-display text-5xl md:text-7xl font-black leading-none">
                <span className="text-white">REJOINS </span>
                <span className="text-shimmer">KCKILLS</span>
              </h1>
              <p className="mt-6 max-w-md text-base md:text-lg text-white/75 leading-relaxed">
                Connecte-toi pour <strong className="text-[var(--gold)]">noter les kills</strong>,
                commenter et partager. Zero mot de passe — juste Discord.
              </p>

              <ul className="mt-8 space-y-3">
                {[
                  "Note chaque kill sur 5 étoiles",
                  "Commentaires + réponses",
                  "Badges communauté",
                  "Historique de tes ratings",
                ].map((f) => (
                  <li
                    key={f}
                    className="flex items-center gap-3 text-sm text-white/80"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--gold)]/20 text-[var(--gold)] text-xs">
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <p className="mt-8 text-[10px] text-white/40 uppercase tracking-widest">
                Zero-knowledge · Discord ID hashé SHA-256 ·{" "}
                <Link href="/privacy" className="underline hover:text-[var(--gold)]">
                  Confidentialité
                </Link>
              </p>
            </div>

            {/* Right — the button card */}
            <div className="max-w-md md:ml-auto w-full">
              <div className="rounded-2xl border border-[var(--gold)]/30 bg-black/60 backdrop-blur-md p-6 md:p-8">
                <button
                  onClick={handleDiscordLogin}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#5865F2] px-6 py-4 font-display font-bold text-white transition-all hover:bg-[#4752C4] hover:shadow-xl hover:shadow-[#5865F2]/30 disabled:opacity-60 disabled:cursor-wait"
                >
                  {loading ? (
                    <>
                      <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Connexion…</span>
                    </>
                  ) : (
                    <>
                      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                      </svg>
                      Continuer avec Discord
                    </>
                  )}
                </button>

                {error && (
                  <p className="mt-3 rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-2 text-xs text-[var(--red)]">
                    {error}
                  </p>
                )}

                {returnTo !== "/" && (
                  <p className="mt-4 text-[11px] text-white/50 leading-relaxed">
                    Tu seras ramené à{" "}
                    <code className="rounded bg-white/10 px-1 font-mono text-white/70">
                      {returnTo}
                    </code>{" "}
                    après la connexion.
                  </p>
                )}

                <p className="mt-6 text-[10px] text-white/40 text-center leading-relaxed">
                  Tu peux supprimer ton compte à tout moment dans{" "}
                  <Link href="/settings" className="underline hover:text-[var(--gold)]">
                    les paramètres
                  </Link>
                  .
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary in the app router.
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--gold)] border-t-transparent" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
