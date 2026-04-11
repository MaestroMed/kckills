# KCKILLS — Feature Tracker
# Derniere mise a jour : 10 avril 2026
# Referentiel complet : ce qui est fait, ce qui manque.

---

## LEGENDE
- [x] = Implemente et fonctionnel
- [~] = Partiellement implemente (code ecrit, pas wire ou pas teste)
- [ ] = Pas implemente

---

## 1. DONNEES & PIPELINE

### Data fetch
- [x] Script `fetch_real_data.py` — fetch 83 matchs KC depuis LoL Esports API
- [x] Stats par joueur par game (KDA, gold, CS, level, champion)
- [x] Tous les adversaires avec KDA
- [x] VOD YouTube IDs depuis getEventDetails
- [x] Fichier `data/kc_matches.json` (520 KB, 111 games)
- [ ] Kill events individuels (le livestats feed donne des snapshots KDA, pas des events)
- [ ] Backfill kills via diff de frames (harvester ecrit, pas execute)
- [x] Import Oracle's Elixir CSV integre (modules/data_fallback.py)
- [x] Import Leaguepedia Cargo API integre (modules/data_fallback.py)

### Worker Python
- [x] Architecture asyncio supervisee (`main.py`)
- [x] Rate limiter centralise (`scheduler.py`) avec delays + quotas journaliers
- [x] Cache SQLite local fallback (`local_cache.py`)
- [x] Dockerfile
- [x] `.env.example` avec toutes les cles
- [~] Sentinel — detecte matchs KC (code ecrit, pas teste avec Supabase)
- [~] Harvester — diff frames kill detection (algorithme ecrit, pas teste)
- [~] Clipper — triple format H+V+V_low (code ecrit, ffmpeg pas teste)
- [~] Analyzer — Gemini 2.5 Flash-Lite (prompt + code, pas de GEMINI_API_KEY)
- [~] Moderator — Claude Haiku 4.5 (prompt + code, pas de ANTHROPIC_API_KEY)
- [~] OG Generator — Pillow 1200x630 (code ecrit, pas teste)
- [~] Watchdog — monitoring + Discord (code ecrit, pas de webhook)
- [x] Tests unitaires : test_scheduler.py (5 tests), test_harvester.py (5 tests) — tous passent
- [x] VOD Hunter porte dans le nouveau worker (modules/vod_hunter.py)
- [x] Heartbeat Supabase anti-pause (modules/heartbeat.py, ping toutes les 6h)
- [x] pg_dump backup script (scripts/backup_db.sh, garde les 4 derniers)

### Services API
- [x] `lolesports_api.py` — schedule, event details, is_kc()
- [x] `livestats_api.py` — frames, participants, KDA extraction
- [x] `supabase_client.py` — insert/update/select avec fallback cache
- [x] `discord_webhook.py` — notifications + daily report
- [x] `youtube_dl.py` — download segment + search avec retry/backoff
- [x] `ffmpeg_ops.py` — encode H/V/V_low + thumbnail
- [x] `r2_client.py` — upload R2
- [x] `gemini_client.py` — analyze avec video input
- [x] `haiku_client.py` — moderate
- [x] `oracles_elixir.py` — parse CSV
- [x] `leaguepedia.py` — Cargo API

---

## 2. DATABASE

- [x] Schema SQL complet (`supabase/migrations/001_loltok_schema.sql`)
- [x] 15 tables : teams, players, tournaments, matches, games, game_participants, game_vod_sources, kills, profiles, ratings, comments, kill_tags, community_clips, push_subscriptions, health_checks
- [x] Triggers : auto-update avg_rating, comment_count, search_vector
- [x] RPC : fn_get_feed_kills, fn_record_impression
- [x] RLS sur toutes les tables
- [x] Indexes optimises (17 index)
- [x] Seed data KC roster 2026
- [ ] Schema PAS execute en production (pas de Supabase project)

---

## 3. FRONTEND — Pages

### Homepage (/)
- [x] Hero plein ecran (85vh) avec splash art bg + KC logo
- [x] Stat "674 kills" en grand
- [x] CTAs : "Scroll les kills" + "Matchs"
- [x] Roster en bandes verticales plein ecran (70vh) avec vraies photos joueurs
- [x] Hover sur roster : bande expand flex-[2], autres greyscale, stats apparaissent
- [x] KC Timeline avec 9 eres enrichies (histoire, viewership, liens YouTube, roster, events)
- [x] Timeline : clic ouvre panneau detail anime (AnimatePresence)
- [x] Timeline : badge LIVE pulse sur 2026 Spring
- [x] Matchs LEC 2026 avec logos KC + adversaire, splash bg on hover, score fade-in
- [x] Dernier match avec detail par game + photos joueurs
- [x] BCC Audio player (bouton "BCC Vibes", iframe YouTube, visualizer anime)
- [x] Scroll down indicator (fleche animee)
- [x] Timeline : filtre eres FILTRE les matchs en dessous (HomeFilteredContent)
- [ ] Images custom d'eres (attend les images generees par l'utilisateur)
- [ ] Images custom hero bg

### Scroll (/scroll)
- [x] Plein ecran z-60 (couvre navbar)
- [x] Splash art champion en fond par kill
- [x] Snap scroll y mandatory
- [x] Badges KC Kill / KC Death / Victory
- [x] Multi-kill badges (penta shimmer, quadra, triple, double)
- [x] Score points affiche sur kills > 15pts
- [x] KDA + gold + CS par joueur KC
- [x] Match context (opponent, stage, game number, date)
- [x] Sidebar TikTok (Rate, Chat, Share, Detail)
- [x] Bottom sheet rating 5 etoiles avec animation slideUp
- [x] Double-tap pour noter 5/5 avec animation etoile
- [x] Toast notification apres rating
- [x] Trie par Wilson score (meilleures perfs en premier)
- [x] Bouton X pour fermer
- [x] Share via navigator.share()
- [x] Lien vers /kill/[id] depuis Chat et Detail
- [x] Counter #index/total
- [x] Tags auto-derives (clean, outplay, carry, teamfight, stomp, carry_in_loss)
- [x] Compteur commentaires simule sur bouton Chat
- [x] Skeleton/loading state quand aucun item

### Kill detail (/kill/[id])
- [x] Champion portraits killer vs victim
- [x] KDA + gold + CS + score
- [x] Match context avec lien
- [x] Rating interactif 5 etoiles
- [x] Section commentaires avec input
- [x] Breadcrumbs avec losanges dores
- [x] OG meta tags dynamiques
- [x] Clip placeholder avec splash art champion bg + badge "bientot"
- [x] Tags auto-derives (#clean, #outplay, #carry, #stomp)
- [x] Multi-kill badge (penta shimmer, quadra, triple, double)
- [x] Score composite affiche avec etoile

### Players (/players)
- [x] Roster 2026 avec vraies photos joueurs (lolesports CDN)
- [x] Photos en fond de card, hover zoom
- [x] KDA + KDA ratio + games par joueur
- [x] Champions joues (icones)
- [x] Role badge
- [x] Anciens joueurs en greyscale (hover restaure)
- [x] Icones de role LoL (emojis : swords, herb, star, target, shield)
- [x] Tooltips sur champions (data-tooltip)

### Player detail (/player/[slug])
- [x] Photo joueur reelle en avatar
- [x] KDA comme stat reine (4x taille)
- [x] Moyennes par game
- [x] Champions joues avec KDA par champion
- [x] Historique matchs (limite 20, compteur total)
- [x] Breadcrumbs losanges dores
- [x] Photo joueur en hero bg plein ecran (280px)
- [x] Section "meilleures performances" (top 3 par KDA, couronne #1)
- [x] Filtres historique (par champion, resultat, annee)
- [x] Bouton "Afficher tout" au lieu de limite 20

### Matches (/matches)
- [x] Groupes par annee avec separateurs gold diamond
- [x] Logos KC + adversaire sur chaque ligne
- [x] W/L badge + score
- [x] Stage + Bo info
- [x] Accordeon par annee (dernier ouvert par defaut, toggle)
- [x] Filtre par adversaire (input texte)

### Match detail (/match/[slug])
- [x] Logos KC + adversaire en header
- [x] Resultat Victoire/Defaite
- [x] Stats par game (kills, gold, towers, dragons, barons)
- [x] Scoreboard KC avec photos joueurs + KDA
- [x] Scoreboard adversaire
- [x] Breadcrumbs losanges dores
- [x] Timeline de kills (dots gold KC / red opponent, hover scale)
- [x] Distinction visuelle KC (gold left border) vs adversaire (neutre, opacity reduite)
- [x] Liens joueur vers /kill/[id] depuis le scoreboard
- [x] VOD YouTube links affiches quand disponibles (bouton rouge avec locale)

### Top (/top)
- [x] Podium asymetrique (#1 plus grand, couronne animee, splash bg)
- [x] Photos joueurs sur podium
- [x] Score composite Wilson
- [x] Separateurs Top 5 / Top 10 / Top 25 avec gold lines
- [x] Filtres par joueur et par saison
- [x] Liens vers /kill/[id]
- [x] Filtre par champion
- [x] Filtre par multi-kill (triple+, carry 5+, perfect 0 deaths)

### Login (/login)
- [x] Page Discord OAuth avec bouton
- [x] Auth callback route
- [ ] Non connecte a Supabase (pas de project)

### Settings (/settings)
- [x] Profil section
- [x] Lier Riot (placeholder disabled)
- [x] Export donnees (placeholder)
- [x] Supprimer compte (placeholder + confirm)
- [x] RGPD compliant (structure)
- [ ] Rien ne fonctionne sans Supabase

### Community (/community)
- [x] Page avec formulaire de soumission
- [x] Champs URL + titre
- [x] Formulaire fonctionnel (local state, detection plateforme, feedback soumission)
- [x] Clips soumis affiches avec badge "En attente"

---

## 4. FRONTEND — Composants

### Utilises
- [x] `navbar.tsx` — Logo SVG, nav links, Discord login, CTA, mobile menu
- [x] `KCTimeline.tsx` — 9 eres, framer-motion, panneau detail, liens YouTube, LIVE badge
- [x] `TimelineWrapper.tsx` — Client wrapper pour la timeline
- [x] `AudioPlayer.tsx` — BCC YouTube audio, visualizer, dismiss
- [x] `LiveBanner.tsx` — Poll getLive, bandeau KC EN LIVE rouge pulse
- [x] `star-rating.tsx` — 5 etoiles interactives, hover glow
- [x] `Toast.tsx` — Toast provider, success/info/error, auto-dismiss
- [x] `Providers.tsx` — Client wrapper pour ToastProvider
- [x] `MultiKillBadge.tsx` — penta shimmer, quadra, triple, double

### Non utilises / partiellement
- [~] `SearchFilters.tsx` — Composant cree mais PAS integre dans aucune page
- [~] `kill-card.tsx` — Ancien composant, non utilise dans les nouvelles pages
- [~] `KillScrollItem.tsx` — Ancien composant, remplace par scroll-feed.tsx
- [~] `video-player.tsx` — YouTube embed pret, pas utilise (pas de clips)
- [~] `comment-section.tsx` — Threaded comments, remplace par interactions.tsx

---

## 5. FRONTEND — Design System

- [x] Palette Hextech (--bg-primary, --gold, --cyan, --red, etc.)
- [x] Fonts Google : Cinzel (display) + Fira Sans (body) + Space Mono (data)
- [x] Glass navbar (blur 16px + saturate 180%)
- [x] Gold shimmer text animation
- [x] Hero gradient multi-radial
- [x] Noise texture overlay
- [x] Cards hover : translateY + scale + gold border + shadow
- [x] Match rows : gold left-border reveal on hover
- [x] Roster bands : flex expand + greyscale siblings
- [x] Stat cards : gold line top on hover
- [x] Champion icons : scale + glow on hover
- [x] Stars : scale 1.3 + rotate + drop-shadow on hover
- [x] Multi-kill shimmer (badge-penta)
- [x] Timeline era cards : grayscale inactive, scale active
- [x] Staggered fadeInUp on page load
- [x] Custom gold scrollbar
- [x] Gold text selection
- [x] CSS tooltips (data-tooltip)
- [x] Scroll snap y mandatory
- [x] Bottom sheet slideUp animation
- [x] Double-tap scaleIn star animation
- [x] prefers-reduced-motion support
- [x] Focus ring gold (a11y)
- [x] Skip-to-content link (a11y)

---

## 6. FRONTEND — Securite & PWA

- [x] Security headers : X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, HSTS
- [x] Disclaimer Riot dans footer
- [x] PWA manifest.json (start_url /scroll, standalone, portrait)
- [x] Service worker sw.js (precache, network-first, push notifications)
- [x] SW registered dans layout
- [x] PWA icon SVG (icon.svg, logo gradient or)
- [x] VAPID keys generation script (scripts/generate_vapid.py)

---

## 7. INFRASTRUCTURE — Non configure

- [ ] Supabase project
- [ ] Schema SQL execute en production
- [ ] Cloudflare R2 bucket
- [ ] Discord OAuth app (Supabase Auth)
- [ ] Gemini API key
- [ ] Anthropic API key
- [ ] Discord webhook
- [x] Domaine kckills.com (achete sur Hostinger, DNS Cloudflare)
- [ ] Vercel deployment
- [ ] Umami analytics

---

## 8. IMAGES — En attente

- [ ] `web/public/images/eras/2021-lfl.jpg` — La Genese
- [ ] `web/public/images/eras/2022-rekkles.jpg` — L'Ere Rekkles
- [ ] `web/public/images/eras/2023-lec.jpg` — L'Ascension
- [ ] `web/public/images/eras/2024-rookie.jpg` — LEC Rookie
- [ ] `web/public/images/eras/2025-sacre.jpg` — Le Sacre (KC 3-0 G2)
- [ ] `web/public/images/eras/2025-spring.jpg` — First Stand Seoul
- [ ] `web/public/images/eras/2025-summer.jpg` — Le Drame
- [ ] `web/public/images/eras/2026-versus.jpg` — Le Renouveau
- [ ] `web/public/images/eras/2026-spring.jpg` — En Cours
- [ ] `web/public/images/hero-bg.jpg` — Hero cinematic KC
- [ ] `web/public/images/players/canna-bg.jpg` — Fond joueur
- [ ] `web/public/images/players/yike-bg.jpg`
- [ ] `web/public/images/players/kyeahoo-bg.jpg`
- [ ] `web/public/images/players/caliste-bg.jpg`
- [ ] `web/public/images/players/busio-bg.jpg`

---

## 9. PRIORITES POUR DEMO ETOSTARK

### P0 — Bloquant pour demo
1. [ ] Images eres (attend generation utilisateur)
2. [ ] Images hero bg
3. [ ] PWA icons

### P1 — Important pour impression
4. [ ] Timeline filtre les matchs quand on clique une ere
5. [ ] Player page hero bg avec photo plein ecran
6. [ ] Tags sur scroll items
7. [ ] Match page timeline kills interactive

### P2 — Polish
8. [ ] Skeleton loaders
9. [ ] Tooltips champion partout
10. [ ] Filtres sur /matches et /player historique
11. [ ] Compteur commentaires sur scroll Chat button
12. [ ] /community fonctionnel
13. [ ] /settings fonctionnel

### P3 — Production
14. [ ] Supabase connect + schema execute
15. [ ] Worker lance avec API keys
16. [ ] Vrais clips generes
17. [ ] Auth Discord fonctionnelle
18. [ ] Push notifications
19. [ ] Vercel deploy + domaine

---

## STATS PROJET

- **15 routes** frontend (toutes build OK)
- **14 composants** React
- **8 modules** worker Python
- **12 services** worker Python
- **15 tables** SQL
- **83 matchs** reels KC (2024-2026)
- **111 games** avec stats completes
- **674 kills** KC trackes
- **520 KB** de donnees reelles
- **Build** : 0 erreurs TypeScript
