# Handoff — kckills.com — 9 juillet 2026

> Fichier de reprise pour la session Claude Code sur le PC worker.
> Écrit par la session cloud du 8-9 juillet (branche `claude/site-feedback-sync-b53knf`, PR #3).
> Remplace intégralement l'ancien handoff d'avril (périmé : Next 15, migrations 001-008, branche cranky-elion).

---

## Contexte immédiat

Mehdi a fait un tour complet du site et remonté ses remarques. Tout a été traité dans la
**PR #3** : https://github.com/MaestroMed/kckills/pull/3 (draft, 2 commits, préview Vercel verte,
`mergeable_state: clean`). **Elle n'est PAS mergée** — Mehdi voulait tester la préview d'abord :
https://kckills-git-claude-site-feedback-sync-b53knf-sconnect1.vercel.app

**Si Mehdi valide → merger la PR #3 → Vercel déploie en prod automatiquement.**

## Ce que contient la PR #3 (Waves 38 + 38.1)

| Remarque de Mehdi | Fix | Fichier clé |
|---|---|---|
| Menu header caché au hover | `overflow-hidden` retiré du `<nav>` (il clippait tous les dropdowns) | `web/src/components/navbar.tsx` |
| Filtres du panneau scroll sans effet | Moteur de recos gaté par `catalogEnabled` — il réinjectait des voisins non filtrés dans les feeds filtrés/triés | `web/src/components/scroll/v2/ScrollFeedV2.tsx` |
| Clips qui ne se lancent pas (iOS surtout) | Fallback natif HLS→MP4 dans `onError` (les `.m3u8` morts déclaraient l'item cassé → cascade d'auto-skips) | `web/src/components/scroll/v2/FeedPlayerPool.tsx` |
| Clips qui freezent après quelques secondes | **Watchdog anti-stall** : 3 s sans progression → swap MP4 (reprise à la position) → reload → carte d'erreur skippable. Émet l'event analytics `clip.stall` | idem |
| Pas de 16:9 desktop | Cinéma 16:9 **par défaut** sur le wide stage + bouton visible `16:9 ⇄ 9:16` (la touche F existait mais rien ne l'annonçait) | `web/src/components/scroll/v2/ScrollDesktopShell.tsx` |
| Panneau droit du scroll envahissant | Colonne contextuelle **fermée par défaut**, rabattable (bouton flottant + touche C), persistée `kc-scroll-ctx-open` | idem |
| VS Roulette à simplifier | Grille champ-select façon jeu de combat : rouge à gauche, bleu à droite, tuile « ? » aléatoire, **SPIN = losange central**, anciens dropdowns dans un accordéon | `web/src/components/VSRoulette.tsx` |
| Kyeahoo en double dans le VS | Dédup case-insensitive (la table `players` a « kyeahoo » ET « Kyeahoo ») + ordre roster récent→ancien (`KC_ROSTER_RECENCY`) | `web/src/app/vs/page.tsx`, `web/src/lib/kc-assets.ts` |
| Search Console | `metadata.verification.google` via env `GOOGLE_SITE_VERIFICATION` ; fallback prod `SITE_URL` → kckills.com ; sitemap nettoyé ; noindex soft-404 sur `/kill/[id]` | `web/src/app/layout.tsx`, `sitemap.ts` |

## ⚡ Première action sur cette machine : relancer le worker

Le worker est down depuis un moment (le PC était éteint). `git pull` d'abord, puis relancer
comme d'habitude (`start_daemon.bat` sous Windows / `python -m worker.orchestrator` en Docker).
Vérifier ensuite : heartbeat dans la table `health_checks`, rapport Discord, profondeur de la DLQ
après quelques minutes.

⚠️ Piège historique (à re-vérifier s'il s'applique encore) : le daemon tournait sur le repo
PARENT (`C:\Users\Matter1\Karmine_Stats\worker`), pas sur le worktree. Si c'est toujours le
setup, éditer côté parent ET copier vers le worktree avant commit.

## Chantiers prioritaires (validés avec Mehdi : « je veux le finir »)

### 1. Boucle de santé HLS — LE chantier n°1
Les clips qui ne se lançaient pas / freezaient viennent de lignes `kills.hls_master_url`
pointant vers des segments R2 supprimés (séquelle de l'incident r2_cleanup de mai : 61 GB de
`hls/` effacés, restauration manuelle incomplète). Le front est maintenant résilient (fallback +
watchdog) mais la base reste pourrie.

- `worker/modules/hls_packager.py` ne fait que **remplir les NULL** — rien ne détecte un
  manifest renseigné mais mort (404), rien ne le re-NULLe. `scripts/check_coverage.py` compte
  la *présence*, pas la santé.
- **À construire** : un module (ou script one-shot puis module périodique) qui HEAD/GET chaque
  `hls_master_url` non-NULL des kills publiés → 404 = `hls_master_url = NULL` (+ log) → le
  packager les refait naturellement au cycle suivant. Vérifier aussi les `clip_url_*`.
- Croiser avec les events `clip.stall` / `clip.hls.error` émis par le site pour prioriser.
  ⚠️ La contrainte CHECK de la table events n'inclut pas encore ces deux types — migration à
  écrire si on veut les persister côté Postgres (voir commentaires dans
  `web/src/lib/analytics/track.ts`).

### 2. Chasse aux mauvais clips (desk / replays / mauvais timing)
Mehdi : « encore beaucoup de mauvais clips, mauvais timing, des moments inter-match de Desk,
OTP ou de replay ». Cause : offsets VOD faux. L'analyzer Gemini stocke déjà
`kill_visible_on_screen` (bool) par clip.

- Passe rétroactive : tous les kills publiés avec `kill_visible = false` → dépublier
  (`status = 'manual_review'` ou re-clip direct avec `needs_reclip`) et relancer
  `vod_offset_finder_v2` sur leurs games.
- Le QC (`qc_sampler`) n'échantillonne que ~2 % — passer à une passe complète sur le stock
  publié, au moins une fois.
- Durcir la porte de publication : un clip `kill_visible = false` ne devrait JAMAIS atteindre
  `published`.

### 3. Allumer les push notifications (feature complète mais éteinte)
Toute la stack existe (SW v6, endpoints, `push_notifier.py`, toggle /settings) mais AUCUNE clé
VAPID n'est posée → échec silencieux. `worker/scripts/generate_vapid.py` existe : générer,
poser `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (Vercel) + clés privées côté worker, tester une push.

### 4. Traducteur worker
`KCKILLS_TRANSLATOR_ENABLED` est à False par défaut → les descriptions EN/KO/ES ne se génèrent
pas alors que l'i18n du site est complète. L'activer si le budget Gemini le permet.

### 5. Quick wins UX (issus de l'audit du 8 juillet)
- `CommandPalette.tsx` (~l.69) : commentaire périmé qui EXCLUT `/community` de la recherche
  alors que la page a maintenant un vrai formulaire. Réintégrer + ajouter `/week`, `/saved`.
- Sous-titres mensongers de la palette : « Sphère 3D 360 », « Best = curation IA »… ce sont des
  redirects vers /scroll ou des tris. Corriger les libellés ou retirer les entrées.
- Home : garantir un fallback éditorial quand le pipeline n'a rien publié (sections `null`).
- Unifier `/api/live/subscribe` vs `/api/push/subscribe` (même table, désabonnement fantôme).

## Actions côté Mehdi (à lui rappeler)

1. **Merger la PR #3** après test de la préview.
2. **Vercel env** : `NEXT_PUBLIC_SITE_URL=https://kckills.com` (canonicals !) et, après
   inscription GSC, `GOOGLE_SITE_VERIFICATION=<token>`.
3. **Search Console** : propriété « Domaine » via TXT Cloudflare (recommandé), puis soumettre
   `https://kckills.com/sitemap.xml`.
4. **Pilotage cloud** (pour que les futures sessions cloud voient la DB) : dans l'environnement
   claude.ai/code → env vars secrètes `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + network
   policy autorisant `*.supabase.co`. Les sessions cloud pourront alors lire l'état du pipeline
   et poster des `admin_jobs` que le worker exécute (cockpit à distance).

## État git / GitHub

- `main` = `4b55174` (Wave 37) ; la PR #3 (`claude/site-feedback-sync-b53knf`, 2 commits
  `adc7f47` + `d43378e`) est au-dessus. Tout le travail antérieur du portable est déjà dans
  main (squash `ca150e9`).
- Branches remote obsolètes à supprimer quand Mehdi confirme : `claude/cranky-elion-cebf12`,
  `claude/fix-mobile-scroll-Q0RfB` (PR #1 à fermer — fix déjà re-livré depuis),
  `claude/review-deployment-updates-1CM9S`, `main-xk4YG`, `claude/fix-deployment-error-ETzEU`
  (mergée via squash), `wave36-atrium-audit-fixes` (mergée).

## Pièges connus du worker (audit du 8 juillet)

- **Troncature silencieuse PostgREST à 1000 lignes** — bug récurrent (transitioner, harvester,
  vod_hunter, data_fallback). Toujours paginer ou `limit` explicite.
- **`scripts/r2_cleanup.py` est DANGEREUX** (a effacé 61 GB de HLS en mai). Mode purge HLS
  désactivé en dur — ne pas le réactiver sans dry-run + allowlist.
- **Deux entrypoints** à garder synchro : `main.py` (daemon mono-process Windows) et
  `orchestrator.py` (rôles multi-process Docker). `test_orchestrator_roles.py` verrouille les
  listes de modules — le faire tourner après toute modif.
- Pas de tests sur clipper / sentinel / hls_packager (le cœur) — en ajouter avec les fixtures
  existantes quand on touche ces modules.

## Ce qui marche bien (ne pas casser)

Le scroll avec musique, le feed, les pages détail, l'admin, l'auth Discord, la DLQ/watchdog du
worker. Mehdi : « quelques clips font TRÈS TRÈS PLAISIR, on a fait de belles choses ». Le cœur
du produit est bon — le boulot restant, c'est la **qualité du stock de clips** (chantiers 1-2).
