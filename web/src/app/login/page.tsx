"use client";

import { createSupabaseBrowser } from "@/lib/supabase-browser";

export default function LoginPage() {
  const handleDiscordLogin = async () => {
    const supabase = createSupabaseBrowser();
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <div className="mx-auto max-w-md space-y-8 py-16">
      <div className="text-center">
        <h1 className="font-display text-3xl font-bold">
          Rejoins <span className="text-[var(--gold)]">KCKILLS</span>
        </h1>
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Connecte-toi pour noter les kills et commenter.
          <br />
          Zero mot de passe. Discord uniquement.
        </p>
      </div>

      <button
        onClick={handleDiscordLogin}
        className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#5865F2] px-6 py-4 font-semibold text-white transition-all hover:bg-[#4752C4] hover:shadow-lg hover:shadow-[#5865F2]/20"
      >
        <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
        </svg>
        Continuer avec Discord
      </button>

      <p className="text-center text-[10px] text-[var(--text-disabled)] leading-relaxed">
        En te connectant, tes votes et commentaires seront publics.
        <br />
        Tu peux supprimer ton compte a tout moment dans les parametres.
      </p>
    </div>
  );
}
