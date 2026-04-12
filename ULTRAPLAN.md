# KCKILLS — ULTRAPLAN 2026 (v2)

Version 2 — 11 avril 2026, 20h45 CET
Etat actuel : **deploye en production sur https://kckills.com** via Vercel.
Pushe 11 batchs depuis le morning. Audit Opus 4.6 pris en compte.

Ce document est la source de verite pour la roadmap complete, de la vision
produit jusqu'au pipeline de production des clips.

---

## VISION PRODUIT FINALE

**Ce qu'on vise** : le meilleur site fan sur une seule equipe esport jamais
shippe. Pas "correct pour un site fan", pas "bon pour du Next.js" — **le site
legendaire que la KC Army forwarde a ses potes sans explication**.

### Les 4 piliers

1. **TikTok des kills** — /scroll vertical plein ecran avec les vrais clips
   MP4 des kills reels, generes automatiquement par notre worker Python
   depuis les VODs officielles LEC. Scroll fluide, autoplay, rating, share.

2. **Timeline cinematographique** — frise interactive des 16 epoques KC de
   2021 a 2026. Chaque epoque a sa page dediee avec clips curates, roster,
   moment cle, stats, links vers reactions/highlights.

3. **Pages joueurs futuristes** — chaque joueur KC (actuel + alumni) a sa
   page cinematique avec ses meilleurs moments en clips, ses stats
   carriere, ses champions signature, ses records personnels.

4. **Pipeline automatise 24/7** — worker Python qui detecte les nouveaux
   matchs LEC, extrait les kills via livestats API, les clippe via yt-dlp
   + ffmpeg, les analyse via Gemini, les moderate via Haiku, les stocke
   sur R2, les pousse sur Supabase, les affiche sur le site. Tout sans
   intervention manuelle.

### Experience cible (le "wow" final)

- **T+0s** : user arrive sur kckills.com, hero en video loop du Sacre en
  background, "674 kills" qui compte depuis 0
- **T+3s** : user clique sur "Scroll les kills"
- **T+4s** : feed TikTok vertical plein ecran avec AUTOPLAY du meilleur
  pentakill Caliste, stats overlay, rating etoiles
- **T+12s** : user swipe up, nouveau clip : Vladi Viktor 10/1/7 vs G2 Game 3
- **T+30s** : user a vu 5 clips cinematiques, ses yeux sont scotches
- **T+60s** : user partage le lien sur Discord, 10 amis cliquent

**KPI primaires** :
- Temps moyen de session > 3 minutes
- Bounce rate < 40%
- 20%+ des users rate au moins 1 kill
- 10%+ des users installent la PWA
- 100+ partages Discord/Twitter par semaine une fois le stream d'Eto

---

## OU ON EN EST (etat au 11 avril 2026, 20h45)

### Infrastructure ✅ operationnelle

- Domaine **kckills.com** achete, DNS Cloudflare, SSL actif
- **Supabase** projet actif avec schema 15 tables + RLS + triggers + seed KC
- **Cloudflare R2** bucket `kckills-clips` avec custom domain `clips.kckills.com`
- **Vercel** hobby deploy auto sur chaque push main
- **Discord OAuth** configure dans Supabase
- **Gemini API key** configuree
- **YouTube Data API** configuree
- **Sentry** pas encore installe
- **Anthropic API (Haiku)** pas encore (moderation commentaires, peut attendre)

### Code frontend ✅ deploye (83 matchs reels)

- Home cinematique avec hero clip rotator auto-play (5 clips en rotation)
- Timeline 16 epoques granulaires avec drag scroll + hover popup + click fix
- Pages /era/[id] avec contenu enrichi (moment cle, reverse sweep narrative, roster, clips YouTube integres)
- Pages /player/[slug] futuristes clips-focused avec stats
- Page /matches avec 83 matchs reels
- Page /scroll TikTok vertical avec splash arts + stats (clips MP4 pas encore la)
- HomeClipsShowcase avec 38 vrais clips YouTube extraits via DOM scraping
- SEO: sitemap.xml dynamique (130 URLs), robots.txt, JSON-LD (WebSite + SportsTeam), custom 404
- Security headers: X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS
- PWA manifest + icon + service worker basic
- MacronEasterEgg (click logo 5x -> tweet Macron toast)
- AnimatedNumber (674 kills compte depuis 0)
- Polices Oswald + Inter Tight + JetBrains Mono preloadees

### Code worker Python ⚠️ scaffold present, pas encore lance end-to-end

- Structure modulaire : sentinel, harvester, clipper, analyzer, moderator, og_generator, vod_hunter, watchdog, scheduler, local_cache
- Services : lolesports_api, livestats_api, supabase_client, r2_client, gemini_client, ytdlp, ffmpeg_ops, discord_webhook
- Rate limiter global + cache SQLite de fallback
- Tests unitaires harvester + scheduler
- **JAMAIS execute end-to-end en production** — c'est la prochaine grande etape

### Data ⚠️ partiellement complet

- 83 matchs KC reels depuis l'API lolesports (2024 Winter -> 2026 Spring)
- **111 games seulement** (devrait etre ~200+) a cause d'un bug dans le
  fetcher qui ne scanne que les 100 premieres minutes apres le match start
- BO3/BO5 : seulement games 1 et 2 recuperes, games 3/4/5 manquants
- **Fix applique** dans scripts/fetch_real_data.py (batch 11 - en cours)
- Fetcher re-lance en background, devrait produire ~250+ games avec stats

---

## AUDIT OPUS 4.6 — SCORE ET FINDINGS

**Score global** : **6.5/10** — "bones excellents, polish insuffisant"

**Verdict** : "impressive project" versus "legendary site" — gap = invisible
work (OG tags, loading states, security, animation details, a11y).

### Top 5 showstoppers (audit)

| # | Issue | Status |
|---|-------|--------|
| 1 | `/scroll` completement vide | ✅ FIX batch 7 — top bar + beta pill + CTA vers #highlights, narrative + empty state cinematique |
| 2 | Site invisible a Google | ✅ FIX batch 2 — sitemap.xml + robots.txt + JSON-LD + canonical. Toi : submit a Search Console |
| 3 | Era pages avec images cassees | ✅ FIX batch 5 — 4 nouvelles images source-verifiees (Genese, Plafond, Desert, Winter 24) |
| 4 | No loading states | ⏳ TODO Phase alpha.2 — skeletons Hextech-themed sur /matches /top /player |
| 5 | Mobile navigation | ✅ Deja en place dans navbar.tsx |

### Top 5 quick wins (audit)

| # | Item | Status |
|---|------|--------|
| 1 | OG tags per page template | ✅ FIX batch 7 — generateMetadata enrichi pour /era et /player |
| 2 | Custom 404 page | ✅ FIX batch 2 |
| 3 | Google Search Console submission | 🟡 TOI — pas encore fait, ~10min |
| 4 | Font preload + font-display: swap | ✅ FIX batch 7 |
| 5 | aria-label on icon buttons | ⏳ TODO Phase a11y |

### Fact corrections appliquees

- ✅ **lfl-2021-showmatch** — "Palau Sant Jordi 15 dec 2021, 257 Blue Wall en terre hostile, match retour Carrousel du Louvre 8 jan 2022" au lieu de "showmatch KC vs KOI vague"
- ✅ **lec-2025-winter** (Le Sacre) — narrative complete : UB collapse 1-3 vs G2, lower bracket run FNC -> VIT -> MKOI, Grand Final 3-0, Caliste Royal Roader, reference Macron 2021

### Ce que Opus a repere mais pas encore applique

- ⏳ **Hero image vs video cinematique** — Opus disait "if static image + text overlay, contrast de pic insuffisant pour Oswald headline". Maintenant remplace par HeroClipBackground auto-playing (batch 8)
- ⏳ **LazyMotion vs full framer-motion** — on importe `motion` direct (34KB). Devrait etre LazyMotion + domAnimation (5KB)
- ⏳ **useReducedMotion** — pas check partout, 20-25% des users affectes
- ⏳ **Next/Image + priority + fetchpriority=high** — hero et above-the-fold pas optimises
- ⏳ **Supabase queries cote serveur (RSC)** au lieu de client-side
- ⏳ **R2 images en WebP/AVIF** — actuellement JPG
- ⏳ **Hero text contrast au pic de luminance** — check manuel requis
- ⏳ **CSP header** dans next.config.ts (le reste des headers y est deja)
- ⏳ **Cmd+K global search** (cmdk + shadcn CommandDialog)
- ⏳ **shadcn defaults remapped** vers Hextech palette
- ⏳ **layoutId shared element transitions** player card -> player page
- ⏳ **Number counting sur chaque page stats** (pas juste la home)
- ⏳ **Skeletons branded Hextech** au lieu du shadcn default gris

### Narratives missing (audit)

- ⏳ **"Dark era" 2024** — 10th place Winter -> Spring, redemption arc 2025
- ⏳ **Blue Wall 257 ultras** en Barcelone (sub-section sur lfl-2021-showmatch)
- ⏳ **KCX attendance growth** — 3700 (KCX1) -> 12000 (KCX2) -> 28000 (KCX3) -> 30000 (KCX4), visual timeline
- ⏳ **Quote quality** — sourcing real interviews (Kameto streams, post-game press conferences)
- ⏳ **Caliste age restriction story** — 17 ans en 2024 LEC Winter, ne peut pas jouer, domine la LFL sur KCB, puis explose des qu'il est eligible

### Easter eggs (audit)

- ✅ **Macron tweet** (batch 7) — click KC logo 5x
- ⏳ **Konami Code Blue Wall Mode** — secondary easter egg Phase mu
- ⏳ **Hidden /era/darkness** page inversee pour 2024 collapse — Phase mu

---

## LES 12 PHASES (mise a jour)

### PHASE alpha — POLISH IMMEDIAT (quasi-termine)

| # | Tache | Status |
|---|-------|--------|
| α1 | Drag scroll timeline | ✅ batch 1 |
| α2 | Loading skeletons sur /matches /top /player | ⏳ |
| α3 | metadataBase + favicons | ✅ batch 1-2 |
| α4 | 404 custom | ✅ batch 2 |
| α5 | Focus ring global | ✅ globals.css |
| α6 | Alt text audit | ⏳ |
| α7 | Espaces vides homepage | ✅ batch 7 |
| α8 | Menu hamburger mobile | ✅ deja present |
| α9 | Breadcrumb unicode fix | ✅ |
| α10 | Image blur placeholders | ⏳ |

**Effort restant α : ~1.5 jh**

### PHASE beta — SEO & SHAREABILITY (termine)

| # | Tache | Status |
|---|-------|--------|
| β1 | robots.txt | ✅ batch 2 |
| β2 | sitemap.xml dynamique | ✅ batch 2 |
| β3 | JSON-LD WebSite + SportsTeam | ✅ batch 2 |
| β4 | JSON-LD VideoObject par kill | ⏳ |
| β5 | Canonical URLs | ✅ batch 7 |
| β6 | Meta description unique | ✅ batch 7 |
| β7 | Twitter Card tags | ✅ batch 7 |
| β8 | OG images statiques | ✅ batch 7 (era + player) |
| β9 | Font preload | ✅ batch 7 |
| β10 | Hreflang | ⏳ attend i18n |

**Effort restant β : ~0.5 jh (JSON-LD par kill une fois les kills live)**

### PHASE gamma — MOTION & INTERACTIONS

| # | Tache | Status |
|---|-------|--------|
| γ1 | IntersectionObserver fade-in | ⏳ partiellement via whileInView |
| γ2 | Compteurs animes | ✅ batch 3 (AnimatedNumber) |
| γ3 | AnimatePresence route transitions | ⏳ |
| γ4 | GSAP ScrollTrigger timeline cinematic | ⏳ |
| γ5 | Micro-interactions partout | ⏳ |
| γ6 | Glassmorphism badges | ⏳ partiel |
| γ7 | Parallax hero | ⏳ remplace par HeroClipBackground |
| γ8 | Lottie penta explosion | ⏳ |
| γ9 | Loading spinner KC | ⏳ |
| γ10 | prefers-reduced-motion | ✅ batch 8 (HeroClipBackground) |
| γ11 | LazyMotion + domAnimation (audit) | ⏳ |
| γ12 | layoutId shared element | ⏳ |

**Effort restant γ : ~3.5 jh**

### PHASE delta — STATS & CONTENT

| # | Tache | Status |
|---|-------|--------|
| δ1 | Stats avancees (DPM, gold@15...) | ⏳ |
| δ2 | Graphiques recharts | ⏳ |
| δ3 | Comparateur joueur vs joueur | ⏳ |
| δ4 | Champion pool visuel hex grid | ⏳ |
| δ5 | Pages alumni (Rekkles, Vladi, Cabochard...) | ⏳ |
| δ6 | Hall of Fame | ⏳ |
| δ7 | Records & achievements | ⏳ |
| δ8 | Citations joueurs/casters | ⏳ |
| δ9 | Stats comparatives entre eras | ⏳ |
| δ10 | Easter eggs (Macron ok, Konami + darkness pending) | ✅ partiel |
| δ11 | **Narratives Blue Wall 257 + KCX growth + Dark Era 2024** | ⏳ |
| δ12 | **Fact corrections lfl-2021-showmatch + Le Sacre reverse sweep** | ✅ batch 7 |

**Effort restant δ : ~5 jh**

### PHASE epsilon — INFRASTRUCTURE PROD (termine)

| # | Tache | Status |
|---|-------|--------|
| ε1 | Domaine kckills.com | ✅ |
| ε2 | Supabase projet | ✅ |
| ε3 | Schema SQL 001 | ✅ |
| ε4 | Discord OAuth | ✅ |
| ε5 | R2 bucket + custom domain | ✅ |
| ε6 | Vercel deploy | ✅ |
| ε7 | DNS setup | ✅ |
| ε8 | Preview deployments | ✅ |
| ε9 | Sentry | ⏳ |
| ε10 | Vercel Analytics / Plausible | ⏳ |
| ε11 | Rate limiting Upstash | ⏳ |
| ε12 | Security headers CSP | ✅ partiel (CSP pas encore) |

**Effort restant ε : ~1 jh**

### PHASE zeta — WORKER PIPELINE (LA GROSSE) **← PRIORITE ABSOLUE**

Le worker Python est le coeur du produit. Sans lui, pas de vrais clips
videos dans /scroll et on reste au stade "site avec liens YouTube".

#### zeta.1 — Sentinel (detection matchs)
- Poll `getSchedule` LEC toutes les 5 minutes
- Pour chaque match KC completed qu'on a pas encore traite, cree une row
  dans `games` avec `state = 'pending'`
- Log Discord webhook: "New KC match detected: KC vs VIT Week 1"
- **Status: code ecrit, jamais lance end-to-end**

#### zeta.2 — Harvester (extraction kills)
- Pour chaque `game` en `pending`, recupere les frames livestats via
  `feed.lolesports.com/livestats/v1/window/{gameId}`
- Diff des frames pour extraire chaque kill event (epoch + killer + victim +
  position)
- Ecrit les lignes `kills` avec `status = 'raw'`
- Status: code ecrit, detecte kills mais pas valide contre data reelle

#### zeta.3 — VOD Hunter (trouver la video source)
- Utilise `getEventDetails.vod.parameter` (YouTube ID officiel LEC) en priorite
- Fallback: YouTube Data API `search.list` avec titre genere
- Ecrit `game.vod_youtube_id` et `game.vod_offset_seconds`
- Status: code ecrit, quota YouTube a respecter

#### zeta.4 — Clipper (yt-dlp + ffmpeg triple format)
- Pour chaque kill, compute `start = vod_offset + (kill_event_epoch - game_start_epoch) - 8s`
- `yt-dlp --download-sections *{start}-{start+15}`
- ffmpeg triple format:
  - Horizontal 1280x720 H.264 main 3.1 faststart (desktop)
  - Vertical 720x1280 (crop centre + H.264 main 3.1 (scroll mobile)
  - Vertical 360x640 (low quality pour reseau lent)
- Genere thumbnail.jpg (9:16 frame centrale)
- Upload sur R2 dans `clips/{kill_id}/h.mp4`, `v.mp4`, `v_low.mp4`, `thumb.jpg`
- Update `kills.clip_url_horizontal`, `.clip_url_vertical`, `.clip_url_vertical_low`
- Status: code ecrit, jamais test end-to-end

#### zeta.5 — Analyzer (Gemini 2.5 Flash-Lite)
- Pour chaque kill clippe, envoie la video (15s) a Gemini avec prompt:
  "Analyse ce clip de kill LoL. Retourne JSON: {highlight_score 1-10, tags [outplay,teamfight,clutch,...], description 120 chars, kill_visible bool, caster_hype_level 1-5}"
- Rate limit: 1000 RPD free tier, 4s min entre appels
- Update `kills.highlight_score`, `.ai_tags`, `.ai_description`
- Status: code ecrit, prompt pas optimise

#### zeta.6 — OG Generator (Pillow)
- Pour chaque kill analyze, genere 1200x630 PNG:
  - Fond: champion splash art du killer
  - Overlay dark + vignettes
  - Texte Oswald: "{killer.ign} -> {victim.ign}" en gold
  - Stars du rating (si > 0)
  - Badge KC logo en coin
- Upload sur R2 dans `og/{kill_id}.png`
- Update `kills.og_image_url`
- Status: code ecrit, pas teste

#### zeta.7 — Moderator (Claude Haiku) **← optionnel v0**
- Pour chaque comment submitted, envoie a Haiku avec prompt
- Rate limit: 50 RPM
- Update `comments.moderation_status`
- **Status: on skip pour v0** — tous les commentaires auto-approuves jusqu'a flood

#### zeta.8 — Watchdog (health + alerts)
- Heartbeat toutes les 5 min dans `health_checks`
- Metriques journalieres: kills_detected_today, kills_clipped, kills_published, gemini_calls, quota_restant, storage_r2_used
- Discord webhook rapport quotidien 23:00
- Alertes: worker down > 1h, Gemini quota > 900 RPD, Supabase egress > 4GB/mois
- Status: code ecrit, webhook configure a verifier

#### zeta.9 — Scheduler & rate limiter global
- LoLTokScheduler central avec tous les DELAYS
- Quotas journaliers tracked (reset 07:00 UTC)
- Backoff exponentiel sur erreurs
- Status: code ecrit

#### zeta.10 — Local cache SQLite
- Fallback si Supabase inaccessible
- Flush automatique des writes au retour de Supabase
- Status: code ecrit

#### zeta.11 — Tests end-to-end sur 1 match
- Choisir KC vs VIT Spring 2026 Week 1 (match recent, BO3, 3 games)
- Lance le worker en mode `--match-id {id}`
- Verifier: 3 games detectees, ~20-30 kills extraits, 3 VODs trouves, 60-90 clips generes, tous uploades sur R2, Supabase a toutes les lignes
- Metriques: temps total, nombre d'appels API, storage R2 utilise
- Status: pas fait

#### zeta.12 — Backfill 83 matchs
- Lance le worker en mode `--backfill-all` sur un week-end
- Estimation: 83 matchs * ~15 min/match = ~21h CPU + API quota load
- Fragmenter sur plusieurs jours si quota Gemini insuffisant
- Status: pas fait

#### zeta.13 — Service systemd / Task Scheduler
- Auto-restart au boot
- Restart automatique en cas de crash (loop 10s)
- Status: pas fait (toi)

**Effort zeta total : ~10-15 jh [CC+K] + 0.5 jh [USER]**

### PHASE eta — COMMUNITY (apres zeta)

| # | Tache | Status |
|---|-------|--------|
| η1 | Rate 1-5 stars sur /kill/[id] | ⏳ |
| η2 | Comments threaded | ⏳ |
| η3 | Community clips submission | ⏳ |
| η4 | **Edits — fan edits section dediee** | ⏳ |
| η5 | Kill of the Week | ⏳ |
| η6 | Badges gamification | ⏳ |
| η7 | Bot Discord | ⏳ |
| η8 | Twitter share button | ⏳ |
| η9 | Push notifications VAPID | ⏳ |
| η10 | Leaderboard Wilson score | ⏳ |

**Effort eta : ~5 jh**

### PHASE theta — PWA & MOBILE PRO

(voir v1 — pas change)

### PHASE iota — I18N EN

(voir v1 — pas change, mais plus prioritaire apres audit)

### PHASE kappa — QUALITE & TESTS

(voir v1 — pas change)

### PHASE lambda — API PUBLIQUE

(voir v1 — apres zeta + eta)

### PHASE mu — STATE OF THE ART

- μ1 Three.js particles hero
- μ2 **Cmd+K global search** (recommandation forte audit)
- μ3 Ai chat KC bot
- μ4 Timeline cinematic fullscreen (GSAP ScrollTrigger)
- μ5 Video backgrounds loops ← **fait batch 8** (HeroClipBackground)
- μ6 Real-time rating multiplayer
- μ7 Dark mode toggle
- μ8 Accessibility WCAG AA+ full audit
- μ9 **Konami Code Blue Wall Mode** (audit easter egg #1)
- μ10 **Hidden /era/darkness** page inversee (audit easter egg #3)

---

## PHASE nu — CLIP QUALITY (audit v2, 12 avril 2026)

Source: audit externe "KC Kills: Full site audit and automated clip generation
blueprint". Part 2 contient un blueprint detaille pour un pipeline de clips
world-class. Integre ici par ordre d'impact sur la qualite percue des clips.

| # | Tache | Effort | Impact | Status |
|---|-------|--------|--------|--------|
| ν1 | **QC pipeline Gemini timer-read** — calibre l'offset VOD par game en lisant le timer in-game | S | Critical | ✅ fait 12 avril |
| ν2 | **Variable clip duration** — penta=25s, triple=16s, single=10s, baron steal=25s au lieu de 18s fixe | S | Eleve | ⏳ |
| ν3 | **Hype score structure** — scoring par multi_kill + context + shutdown_bounty + gold_diff + solo_play au lieu de Gemini subjectif | M | Eleve | ⏳ |
| ν4 | **Audio analysis caster** — librosa RMS + pYIN pitch tracking, multiplicateur hype 1.0-2.0x | L | Eleve | ⏳ |
| ν5 | **Replay detection** — OCR "REPLAY" + frame rate analysis, preferer le replay broadcast | M | Moyen | ⏳ |
| ν6 | **Smart vertical crop** — YOLO champion tracking center au lieu de crop fixe | M | Moyen | ⏳ |
| ν7 | **Text overlays ffmpeg** — hook text bold (3s), context text, kill counter anime | M | Moyen | ⏳ |
| ν8 | **Caster keyword detection** — Whisper ASR pour "PENTAKILL", "UNBELIEVABLE", bonus hype | L | Moyen | ⏳ |
| ν9 | **HLS/DASH transcoding** — adaptive bitrate pour mobile lent | L | Moyen | ⏳ |
| ν10 | **Context classification structuree** — teamfight/solo_kill/tower_dive/baron_steal via position data | M | Moyen | ⏳ |

Effort total ν : ~8-10 jh. Priorite : ν2 + ν3 d'abord (quick wins), ν4 ensuite
(biggest quality uplift), le reste iteratif.

---

## RECAP TOTAL (mise a jour 12 avril 2026, post-session)

### CE QUI A ETE FAIT DANS LA SESSION DU 12 AVRIL

- ✅ ζ.1-10 : Pipeline end-to-end valide (66 kills published, 1er run)
- ✅ ζ.11 : Test end-to-end KC vs VIT W1 (3 games, 66 clips R2)
- ✅ QC calibration Gemini timer-read (offset +374s broadcast intro)
- ✅ Frontend ↔ Supabase : /scroll, /kill/[id], /match/[slug], /player/[slug]
- ✅ Ratings + comments cables aux API endpoints
- ✅ Desktop 16:9 + KC kills >> deaths dans le scoring
- ✅ Hero MP4 R2 au lieu de YouTube embed (bye CAPTCHA)
- ✅ Fix yt-dlp venv (python -m), Gemini file-wait, cookies fallback
- ✅ α2 : Hextech skeletons
- ✅ γ11 : LazyMotion migration (-28 KB)
- ✅ δ5 : 5 alumni pages
- ✅ δ11 : Dark Era + Blue Wall narratives
- ✅ μ2 : Cmd+K global search
- ✅ μ10 : /era/darkness easter egg

### EFFORT RESTANT

| Phase | Nom | Effort restant | Notes |
|-------|-----|----------------|-------|
| α | Polish | 0.5 jh | alt text + blur placeholders |
| β | SEO | 0.5 jh | JSON-LD par kill |
| γ | Motion | 3 jh | AnimatePresence, GSAP, micro-interactions |
| δ | Content | 4 jh | plus d'alumni, stats avancees, recharts |
| ε | Infra | 1 jh | Sentry, analytics, CSP |
| **ζ** | **Worker pipeline** | **3 jh** | backfill 83 matchs, daemon 24/7, YouTube throttle mgmt |
| η | Community | 4 jh | ratings UX, comments threads, Discord bot |
| θ | PWA | 2 jh | install prompt, offline, push notifs |
| ι | i18n | 3 jh | FR/EN |
| κ | Tests | 4 jh | Vitest, Playwright, fixtures |
| λ | API publique | 3 jh | REST endpoints, docs |
| μ | State of the art | 4 jh | Three.js, Konami, AI chat |
| **ν** | **Clip quality** | **8 jh** | variable duration, hype score, audio, overlays |
| **Total** | | **~40 jh** | |

---

## ORDRE D'EXECUTION MIS A JOUR

### Maintenant (12-13 avril)
- ✅ Pipeline QC avec offset calibre (+374s)
- ⏳ Attendre fin du pipeline re-run → kills publiees → /scroll repeupled
- Backfill 5-10 matchs recents avec QC (cookies.txt si YouTube re-throttle)
- ν2 : Variable clip duration
- ν3 : Hype score structure

### Semaine prochaine
- ζ.12 : Backfill massif 83 matchs (week-end, ~21h CPU)
- ζ.13 : Daemon 24/7 (systemd / Task Scheduler)
- η1-2 : Ratings + comments polish
- ε9 : Sentry
- ν4 : Audio analysis caster (librosa, biggest quality uplift)
- δ5 suite : plus d'alumni

### Semaine d'apres
- ν5-7 : Replay detection + smart crop + text overlays
- γ3 : AnimatePresence route transitions
- ι : i18n EN
- **Stream chez Eto / Kameto** 🚀

---

*ULTRAPLAN v3 — 12 avril 2026. Mise a jour post-audit v2 et session pipeline.*
*Le site est LIVE sur kckills.com avec de vrais clips MP4 auto-generes.*
