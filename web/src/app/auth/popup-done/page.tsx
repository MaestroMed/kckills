"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Fin de la connexion Discord ouverte en fenêtre (InlineAuthPrompt) :
 * prévient la page d'origine (qui relance l'action — noter, commenter…) et
 * se ferme. Sans fenêtre parente (popup bloquée, ouverture directe), renvoie
 * simplement vers la page de départ.
 */
function PopupDone() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const raw = params.get("next") ?? "/";
    const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: "kc:auth:success" }, window.location.origin);
      window.close();
      return;
    }
    router.replace(next);
  }, [params, router]);
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-[var(--text-secondary)]">
      Connexion réussie, retour au site…
    </div>
  );
}

export default function PopupDonePage() {
  return (
    <Suspense>
      <PopupDone />
    </Suspense>
  );
}
