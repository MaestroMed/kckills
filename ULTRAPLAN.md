# KCKILLS — ULTRAPLAN 2026

Version 1 — 11 avril 2026
Etat actuel : frontend Next.js 15 en local sur :3000, worker Python partiellement cable,
aucune API key en production, 83 matchs KC en JSON fige, 111 games, 674 kills estimes.

Ce document mappe les 20 points d'audit a 12 phases operationnelles. Chaque tache est
taguee **[CC]** (Claude) ou **[USER]** (toi) et chiffree en journees homme.

---

## LEGENDE

- **[CC]** : Claude peut le faire seul sans clef API
- **[CC+K]** : Claude peut le faire mais necessite une clef API deja configuree
- **[USER]** : toi (creation compte, achat domaine, signature contrat...)
- **jh** : journees homme estimees

---

## PHASE α — POLISH IMMEDIAT (1-2 jh) — sans cles API

Objectif : tuer les bugs visibles immediatement, gagner +40% de perception qualite.

| # | Tache | Type | Effort |
|---|-------|------|--------|
| α1 | **Drag scroll timeline** — pointer events + useRouter (FAIT ce tour) | [CC] | 0 |
| α2 | **Loading skeletons** — plus d'ecran noir, shimmer Tailwind sur chaque route | [CC] | 0.5 |
| α3 | **metadataBase + favicons** — favicon.ico + apple-touch-icon + splash iOS + metadataBase | [CC] | 0.25 |
| α4 | **404 custom** — page /not-found brandee KC avec clip aleatoire en fond | [CC] | 0.25 |
| α5 | **Focus ring global** — 2px solid gold sur :focus-visible | [CC] | 0.1 |
| α6 | **Alt text audit** — toutes les images generent un alt descriptif ou alt="" explicite | [CC] | 0.25 |
| α7 | **Espaces vides homepage** — corriger les grands vides en bas de page | [CC] | 0.25 |
| α8 | **Menu hamburger mobile** — nav horizontale → drawer plein ecran < 768px | [CC] | 0.5 |
| α9 | **Breadcrumb unicode** — fix des caracteres cassees sur /players /matches | [CC] | 0.1 |
| α10 | **Lazy + blur placeholders** — `<Image placeholder="blur">` partout | [CC] | 0.25 |

**Total phase α : ~2 jh [CC] sans aucune cle API.**

---

## PHASE β — SEO & SHAREABILITY (1-2 jh) — sans cles API

Objectif : Google et les reseaux sociaux voient enfin le site correctement.

| # | Tache | Type | Effort |
|---|-------|------|--------|
| β1 | **robots.txt** — route static + disallow /api/ | [CC] | 0.1 |
| β2 | **sitemap.xml dynamique** — src/app/sitemap.ts auto-genere (home + 16 eras + joueurs + matches) | [CC] | 0.25 |
| β3 | **JSON-LD WebSite + SportsTeam + Organization** — injection dans layout.tsx | [CC] | 0.25 |
| β4 | **JSON-LD VideoObject par /kill/[id]** — pour Google Rich Results | [CC] | 0.25 |
| β5 | **Canonical URLs** — chaque page a sa <link rel="canonical"> | [CC] | 0.1 |
| β6 | **Meta description unique** — par page via generateMetadata() | [CC] | 0.25 |
| β7 | **Twitter Card tags** — summary_large_image sur toutes les routes | [CC] | 0.1 |
| β8 | **Open Graph images statiques** — fallback PNG 1200x630 pour home + top routes | [CC] | 0.25 |
| β9 | **Font preload** — next/font avec display: swap sur Oswald/Inter/JetBrains | [CC] | 0.1 |
| β10 | **Hreflang + htmlLang** — prep pour i18n phase ι | [CC] | 0.1 |

**Total phase β : ~2 jh [CC] sans aucune cle API.**

---

## PHASE γ — MOTION & INTERACTIONS (3-4 jh) — sans cles API

Objectif : "wow factor" cinematographique. Chaque page respire et bouge.

| # | Tache | Type | Effort |
|---|-------|------|--------|
| γ1 | **IntersectionObserver fade-in** — hook useInView qui declenche les motion.div au scroll | [CC] | 0.25 |
| γ2 | **Compteurs animes** — `<AnimatedNumber>` pour 674 kills / 83 matchs / 64.4% WR | [CC] | 0.5 |
| γ3 | **AnimatePresence route transitions** — fondu entre les pages via template.tsx | [CC] | 0.5 |
| γ4 | **GSAP ScrollTrigger timeline cinematique** — scroll vertical = avance temporel dans la frise, type site Apple | [CC] | 1.5 |
| γ5 | **Micro-interactions** — hover scale + shadow + gradient shift sur toutes les cards | [CC] | 0.5 |
| γ6 | **Glassmorphism badges** — backdrop-blur-xl + inset highlight sur les stats | [CC] | 0.25 |
| γ7 | **Parallax hero** — transform Y scroll-locked sur les images de fond | [CC] | 0.5 |
| γ8 | **Lottie penta explosion** — lottie-react + pack icon pour multi-kills | [CC] | 0.5 |
| γ9 | **Loading spinner KC brande** — logo hextech qui tourne en chargement | [CC] | 0.25 |
| γ10 | **prefers-reduced-motion** — desactive tout si l'utilisateur le demande | [CC] | 0.1 |

**Total phase γ : ~4 jh [CC] sans aucune cle API.**

---

## PHASE δ — STATS & CONTENT (4-5 jh) — sans cles API

Objectif : la depth de contenu qui fait dire "ces gens connaissent KC par coeur".

| # | Tache | Type | Effort |
|---|-------|------|--------|
| δ1 | **Stats avancees** — damage share, gold diff @15, CS/min, DPM, KP%, wards, pink wards | [CC] | 1 |
| δ2 | **Graphiques recharts** — evolution KDA par match, histogramme winrate | [CC] | 0.75 |
| δ3 | **Player vs player comparator** — /compare?p1=Canna&p2=Cabochard | [CC] | 0.75 |
| δ4 | **Champion pool visuel** — hex grid splash arts avec winrate par champion | [CC] | 0.5 |
| δ5 | **Pages alumni** — Vladi, Rekkles, Cabochard, Adam, xMatty, Saken, Upset, Targamas, Bo, Closer, Hantera, 113, Cinkrof. Vue futuriste identique aux joueurs actifs | [CC] | 1 |
| δ6 | **Hall of Fame** — /hall-of-fame avec les 10 plus grands moments (Rekkles 16/1/25, Vladi Viktor 10/1/7, comeback Flying Oyster...) | [CC] | 0.5 |
| δ7 | **Records & achievements** — plus gros KDA, plus long comeback, plus de dragons, etc. | [CC] | 0.5 |
| δ8 | **Citations joueurs/casters** — quotes dans les pages /era/[id] | [CC] | 0.25 |
| δ9 | **Stats comparatives entre eras** — spider chart LFL vs LEC 2024 vs LEC 2025 | [CC] | 0.5 |
| δ10 | **Easter eggs** — konami code, click sur logo KC → confetti | [CC] | 0.25 |

**Total phase δ : ~5 jh [CC] sans aucune cle API.**

---

## PHASE ε — INFRASTRUCTURE PRODUCTION (3-5 jh) — cles API requises

Objectif : site en production avec domaine, DB reelle, CDN, monitoring.

| # | Tache | Type | Effort |
|---|-------|------|--------|
| ε1 | **Acheter domaine kckills.com ou kckills.com** | [USER] | 0.1 |
| ε2 | **Creer projet Supabase** (free tier) | [USER] | 0.1 |
| ε3 | **Executer schema SQL** — 001_initial_schema.sql | [CC+K] | 0.5 |
| ε4 | **Creer Discord OAuth app** | [USER] | 0.1 |
| ε5 | **Brancher Discord dans Supabase Auth** | [CC+K] | 0.25 |
| ε6 | **Creer bucket Cloudflare R2** + custom domain clips.kckills.com | [USER] | 0.25 |
| ε7 | **Deploy Vercel** + environment variables | [CC+K] | 0.5 |
| ε8 | **DNS setup** — A record Vercel + CNAME R2 | [USER] | 0.25 |
| ε9 | **Preview deployments GitHub** — auto sur chaque push | [CC] | 0.1 |
| ε10 | **Sentry error tracking** — @sentry/nextjs installe + DSN | [CC+K] | 0.5 |
| ε11 | **Vercel Analytics** + Plausible self-hosted (optionnel) | [CC+K] | 0.25 |
| ε12 | **Rate limiting** — Upstash Redis pour votes/comments (free tier) | [CC+K] | 0.5 |
| ε13 | **Security headers** — next.config.js CSP + HSTS + X-Frame-Options | [CC] | 0.25 |

**Total phase ε : ~2.5 jh [CC+K] + ~0.75 jh [USER]. Cles necessaires : Supabase, Discord, R2, Vercel, Sentry, Upstash (optionnel).**

---

## PHASE ζ — WORKER & CLIPS PIPELINE (7-10 jh) — cles API requises

Objectif : les vraies clips des vrais kills KC apparaissent automatiquement sur le site.

| # | Tache | Type | Effort |
|---|-------|------|--------|
| ζ1 | **Creer compte Gemini AI Studio** + API key | [USER] | 0.1 |
| ζ2 | **Creer compte Anthropic** (Haiku) + 10 € de credit | [USER] | 0.1 |
| ζ3 | **Creer projet Google Cloud** + activer YouTube Data API v3 | [USER] | 0.25 |
| ζ4 | **SENTINEL** — poll schedule LEC via lolesports API, detecte matchs KC | [CC+K] | 1 |
| ζ5 | **HARVESTER** — diff frames livestats, detection kills avec correlation | [CC+K] | 1.5 |
| ζ6 | **VOD_HUNTER** — getEventDetails.vod.parameter + fallback YouTube search | [CC+K] | 1 |
| ζ7 | **CLIPPER** — yt-dlp --download-sections + ffmpeg triple format | [CC+K] | 1.5 |
| ζ8 | **ANALYZER** — Gemini 2.5 Flash-Lite avec prompt JSON structure | [CC+K] | 0.75 |
| ζ9 | **OG_GENERATOR** — Pillow 1200x630 pre-genere et uploade sur R2 | [CC+K] | 0.75 |
| ζ10 | **MODERATOR** — Haiku pour commentaires avec cache Supabase | [CC+K] | 0.5 |
| ζ11 | **WATCHDOG** — heartbeat + discord webhook + metrics quotidiennes | [CC+K] | 0.5 |
| ζ12 | **Scheduler global** — rate limiter partage tous modules | [CC] | 0.5 |
| ζ13 | **Local cache SQLite** — fallback si Supabase down | [CC] | 0.5 |
| ζ14 | **Tests end-to-end** — 1 match reel traite de bout en bout | [CC+K] | 0.5 |
| ζ15 | **Backfill 83 matchs** — lance sur un WE, ~674 kills clippes | [CC+K] | 0.5 (CPU) |
| ζ16 | **Service systemd/taskscheduler** — auto-restart worker au reboot | [USER] | 0.25 |

**Total phase ζ : ~10 jh [CC+K] + ~0.7 jh [USER]. Cles necessaires : Gemini, Anthropic, YouTube API, + ε3 ε6.**

---

## PHASE η — COMMUNITY (3-5 jh) — apres ε

Objectif : ratings, commentaires, social, viralite, gamification.

| # | Tache | Type | Effort |
|---|-------|------|--------|
| η1 | **Rate 1-5 stars** — /kill/[id] avec persistance Supabase RLS | [CC+K] | 0.5 |
| η2 | **Commentaires threades** — moderation auto via Haiku + affichage approved only | [CC+K] | 1 |
| η3 | **Community clips** — soumission YouTube/TikTok + approbation admin | [CC+K] | 0.75 |
| η4 | **Kill of the Week** — cron route qui reset tous les lundis | [CC+K] | 0.25 |
| η5 | **Badges gamification** — "100 ratings", "premier top 10", etc. | [CC+K] | 0.5 |
| η6 | **Bot Discord** — post auto des nouveaux kills dans #kc-highlights | [CC+K] | 0.5 |
| η7 | **Twitter/X share button** — pre-rempli avec OG image + URL | [CC] | 0.25 |
| η8 | **Push notifications VAPID** — abonnement PWA, send sur publish kill | [CC+K] | 0.75 |
| η9 | **Classement communautaire** — /top avec Wilson score sort | [CC+K] | 0.5 |
| η10 | **Discord bot embed** — commande `/kc lastkill` renvoie un embed riche | [CC+K] | 0.5 |

**Total phase η : ~5 jh [CC+K]. Necessite ε et ζ operationnels.**

---

## PHASE θ — PWA & MOBILE PRO (2-3 jh) — sans cles

Objectif : application installable, experience mobile parfaite.

| # | Tache | Type | Effort |
|---|-------|------|--------|
| θ1 | **Service Worker offline** — cache-first pour assets, network-first pour donnees | [CC] | 0.75 |
| θ2 | **Icons multi-tailles** — 192, 256, 384, 512, maskable | [CC] | 0.25 |
| θ3 | **Splash screens iOS** — generation pour 12+ tailles d'iPhone | [CC] | 0.25 |
| θ4 | **Install prompt** — UI custom pour beforeinstallprompt | [CC] | 0.25 |
| θ5 | **Scroll mode swipe calibre** — snap-mandatory + intersection observer threshold | [CC] | 0.5 |
| θ6 | **Safe area insets** — env(safe-area-inset-*) pour les iPhone notch | [CC] | 0.1 |
| θ7 | **Orientation lock** — portrait force sur /scroll | [CC] | 0.1 |
| θ8 | **Haptic feedback** — navigator.vibrate sur rating 5 stars | [CC] | 0.1 |

**Total phase θ : ~3 jh [CC].**

---

## PHASE ι — INTERNATIONALISATION (2-3 jh) — sans cles

Objectif : version anglaise pour l'audience LEC europeenne.

| # | Tache | Type | Effort |
|---|-------|------|--------|
| ι1 | **next-intl setup** — middleware + config locales | [CC] | 0.25 |
| ι2 | **Extraction strings** — tous les textes FR hardcoded → messages/fr.json | [CC] | 1 |
| ι3 | **Traduction EN** — messages/en.json (DeepL quality) | [CC] | 0.75 |
| ι4 | **Routing /en/era/...** — prefixe locale | [CC] | 0.25 |
| ι5 | **Switcher langue** — dropdown dans la nav | [CC] | 0.25 |
| ι6 | **hreflang tags** — /era/[id] avec alternate EN/FR | [CC] | 0.1 |
| ι7 | **Date formatting locale** — Intl.DateTimeFormat | [CC] | 0.1 |

**Total phase ι : ~3 jh [CC].**

---

## PHASE κ — QUALITE, TESTS, DESIGN SYSTEM (4-5 jh) — sans cles

Objectif : fondations techniques solides, pas de regression a chaque commit.

| # | Tache | Type | Effort |
|---|-------|------|--------|
| κ1 | **Storybook** — install + configs pour tous les composants | [CC] | 1 |
| κ2 | **Design tokens** — src/lib/design-tokens.ts centralise colors/spacing/typography | [CC] | 0.5 |
| κ3 | **Component library** — KillCard, StarRating, EraCard, PlayerCard, Button unifies | [CC] | 1 |
| κ4 | **Vitest unit tests** — tests lib/feed-algorithm + lib/eras helpers | [CC] | 0.5 |
| κ5 | **Playwright E2E** — scroll, click era, navigation joueur, rating | [CC] | 1 |
| κ6 | **Lighthouse CI** — github action sur PR + seuils minimum | [CC] | 0.5 |
| κ7 | **Cross-browser matrix** — Playwright Safari/Firefox/Chrome | [CC] | 0.25 |
| κ8 | **Type coverage 100%** — strict mode + no any | [CC] | 0.5 |

**Total phase κ : ~5 jh [CC].**

---

## PHASE λ — API PUBLIQUE (2-3 jh) — apres ε

Objectif : les fans peuvent construire bots Discord, overlays Twitch, widgets.

| # | Tache | Type | Effort |
|---|-------|------|--------|
| λ1 | **API /api/v1/kills** — GET liste paginee + filtres | [CC+K] | 0.5 |
| λ2 | **API /api/v1/matches** — GET liste + detail par ID | [CC+K] | 0.5 |
| λ3 | **API /api/v1/players** — GET liste + stats par player | [CC+K] | 0.5 |
| λ4 | **API /api/v1/eras** — GET liste depuis lib/eras | [CC] | 0.1 |
| λ5 | **Rate limit public** — 100 req/min par IP via Upstash | [CC+K] | 0.25 |
| λ6 | **CORS policy** — access-control-allow-origin : * (read-only) | [CC] | 0.1 |
| λ7 | **Documentation OpenAPI** — /api/docs avec Swagger UI | [CC] | 0.5 |
| λ8 | **Webhook /api/v1/webhooks** — emitted on new kill/match | [CC+K] | 0.5 |
| λ9 | **Template bot Discord** — github repo starter | [CC] | 0.5 |
| λ10 | **Template overlay Twitch** — HTML + OBS browser source | [CC] | 0.5 |

**Total phase λ : ~4 jh. Necessite ε ζ operationnels.**

---

## PHASE μ — STATE OF THE ART (ongoing) — apres tout le reste

Objectif : le "legendaire". Choses impressionnantes mais pas critiques.

| # | Tache | Type | Effort |
|---|-------|------|--------|
| μ1 | **Three.js particles hero** — hextech crystals qui flottent | [CC] | 1 |
| μ2 | **Cmd+K global search** — fuse.js sur kills + players + eras + matchs | [CC] | 1 |
| μ3 | **AI chat KC bot** — interface sur Haiku fine-tune sur le contexte KC | [CC+K] | 1 |
| μ4 | **Timeline cinematic fullscreen** — appuie E dans la frise = immersive mode scroll-driven | [CC] | 1.5 |
| μ5 | **Video backgrounds loops** — compressed webm sur hero | [CC] | 0.5 |
| μ6 | **Real-time multiplayer rating** — vois les stars se remplir en live | [CC+K] | 1 |
| μ7 | **Dark mode toggle** (on est deja en dark mais option light pour les sadists) | [CC] | 0.5 |
| μ8 | **Accessibility WCAG AA+ full audit** — axe-core + manual | [CC] | 1 |

**Total phase μ : ~7.5 jh. Pas critique.**

---

## RECAP TOTAL

| Phase | Nom | Effort [CC/CC+K] | Effort [USER] | Sans cles ? |
|-------|-----|------------------|---------------|-------------|
| α | Polish immediat | 2 jh | 0 | OUI |
| β | SEO & shareability | 2 jh | 0 | OUI |
| γ | Motion & interactions | 4 jh | 0 | OUI |
| δ | Stats & content | 5 jh | 0 | OUI |
| ε | Infrastructure prod | 2.5 jh | 0.75 jh | NON |
| ζ | Worker & clips | 10 jh | 0.7 jh | NON |
| η | Community | 5 jh | 0 | NON |
| θ | PWA & mobile pro | 3 jh | 0 | OUI |
| ι | i18n | 3 jh | 0 | OUI |
| κ | Qualite, tests, DS | 5 jh | 0 | OUI |
| λ | API publique | 4 jh | 0 | NON |
| μ | State of the art | 7.5 jh | 0 | PARTIEL |
| **Total** | | **~53 jh** | **~1.5 jh** | |

---

## ORDRE D'EXECUTION RECOMMANDE

### Sprint 1 (semaine 1-2) : visible gain sans rien attendre
α → β → γ → δ
Resultat : site prod-ready cote frontend, depth de contenu, motion partout.
**12-13 jh Claude sans aucune cle API.**

### Sprint 2 (semaine 3) : ε en parallele avec θ + κ
Tu fais les creations de compte (ε1-ε8), Claude fait :
- ε3 SQL migration, ε5 Discord binding, ε7 deploy, ε10 Sentry
- θ PWA complete
- κ tests

Parallelement tu :
- Achetes le domaine
- Crees Supabase, Discord, R2, Vercel accounts
- DNS setup

### Sprint 3 (semaine 4-5) : ζ worker
Tu fournis Gemini + Anthropic + YouTube keys, Claude build les 10 modules,
on backfill les 83 matchs, on verifie que /scroll affiche les vrais clips.

### Sprint 4 (semaine 6) : η + λ
Community features + API publique. Preparation du "lancement Eto" stream.

### Sprint 5 (semaine 7+) : μ + ι ongoing
State of the art polish, i18n EN, Cmd+K, etc.

---

## PRIORITE TOP 10 (selon audit utilisateur)

| Rank | Audit | Phase mapped |
|------|-------|--------------|
| 1 | Corriger espaces vides + responsive mobile | α7 α8 |
| 2 | Integrer les clips video dans le scroll | ζ4-15 |
| 3 | Framer Motion partout | γ |
| 4 | SEO technique complet | β |
| 5 | Loading states (skeletons) | α2 |
| 6 | OG images dynamiques par kill | ζ9 |
| 7 | Stats avancees + graphiques | δ1 δ2 |
| 8 | Pages anciens joueurs | δ5 |
| 9 | Recherche globale cmd+K | μ2 |
| 10 | Analytics + Sentry | ε10 ε11 |

---

## CE QUI EST DEJA FAIT (au 11 avril 2026)

- Design system LoL Hextech (couleurs, polices Oswald/Inter/JetBrains Mono)
- Home page full-screen avec hero 85vh + roster bands
- 16 eras granulaires avec page /era/[id] dediee
- Frise scrollable + drag + keyboard nav (ce tour)
- Page /player/[slug] clips-focused futuriste
- Page /scroll TikTok-like (sans vraies videos pour l'instant)
- Page /match/[slug] timeline game par game
- Page /matches avec filtres
- 83 matchs KC + 111 games + stats reelles depuis l'API lolesports
- Worker Python structure avec 10 modules
- Schema Supabase SQL redige (pas encore execute)

## CE QUI MANQUE TOTALEMENT

- Aucune cle API configuree
- Aucun deploy en production
- Aucune vraie clip dans /scroll
- Aucun service worker / push notifications
- Aucun rating/comment/community feature
- Aucun SEO (robots.txt, sitemap, JSON-LD)
- Aucun OG image dynamique
- Aucun test (Vitest, Playwright)
- Aucun monitoring (Sentry, Analytics)
- Aucune i18n
- Aucune API publique

---

*Ce document est la source de verite. Il est versionne dans Git et mis a jour a
chaque sprint. Chaque ligne qui passe de "pending" a "done" doit etre cochee avec
un commit dedie pour que Kairos (et toi) sachent ou on en est.*
