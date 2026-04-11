# KCKILLS — Product Vision

Version 1 — 11 avril 2026
Auteur : Mehdi (Numelite) + Claude (Kairos)
Domaine : https://kckills.com

---

## 🎯 En une phrase

**KCKILLS est le TikTok des kills LoL esport dédié à la Karmine Corp — un feed
cinématographique où chaque moment marquant de l'équipe est clippé, noté,
commenté et partagé par la KC Army.**

Pas un site de stats. Pas un wiki. Pas un aggregator générique. Un site qui fait
ressentir la gloire, la chute, la redemption, et la culture KC.

---

## 👥 Pour qui

### Primary : la KC Army active (500K+ fans FR)
- Fans hardcore qui suivent chaque game en live chez Kameto/Eto
- Connaissent les line-ups, les patches, les rivalités, les drames
- Vivent les moments KC comme des moments perso
- Postent des clips sur Twitter/Discord, commentent Kameto sur ses VODs
- Veulent un endroit qui célèbre LEUR équipe avec le niveau d'effort que
  LEURS joueurs méritent — pas un site neutre, un site **pro-KC**

### Secondary : l'audience LEC européenne curieuse
- Fans d'autres équipes (G2, FNC, MKOI, VIT) qui veulent comprendre le phénomène
- Casters et analystes qui cherchent des clips précis pour leurs videos/streams
- Audience EN qui veut suivre "the French team that won the LEC"

### Tertiary : les streamers KC eux-mêmes
- Kameto, Eto, Prime, Coxyy qui peuvent citer le site en live
- Objectif final : que l'un d'eux le pull up en stream et dise "wait c'est qui
  qui a fait ça ?" — c'est le moment où le site devient viral

---

## 💎 Les 4 piliers du produit

### 1. Le Scroll — TikTok des kills KC
Le coeur du produit. Feed vertical plein écran, swipe, autoplay muted, stats
overlay cinématique, rating 1-5 étoiles en double-tap, partage natif.
Chaque card = un kill réel clippé depuis les VODs officielles LEC, processé
par notre worker Python, stocké sur R2, servi en MP4 H.264 triple résolution
(H 720, V 720, V 360 pour le réseau lent). **Pas un embed YouTube** — du MP4
natif qui loop silencieusement comme un TikTok.

### 2. La Timeline — 16 époques granulaires
De Spring 2021 ("La Genèse" avec Adam) à Spring 2026 ("En Cours"), en passant
par les pics ("Le Sacre Winter 2025") et les creux ("La Traversée du Désert
LFL 2023"). Chaque époque a sa page dédiée plein écran avec hero image
d'époque, narratif rédactionnel, roster, moments clés, clips curatés, stats
comparatives. La frise de la home est scrollable, draggable, chaque carte
ouvre la page dédiée.

### 3. Les Pages Joueurs — cinéma clips-first
Pour chaque joueur (actif et alumni), une page full-screen qui ressemble à
un trailer de film. Hero avec champion loading art + photo grand format,
nom massif, KDA/games/winrate en animated counters, **grid des meilleurs
moments** (tri par KDA), champion pool visuel, historique des matchs.
Pas un tableau stats — une expérience.

### 4. Le Pipeline Python — 24/7, automatisé
Un daemon supervisé qui :
- Détecte les nouveaux matchs KC via lolesports API (Sentinel)
- Extrait les kills via livestats frames diff (Harvester)
- Trouve les VODs YouTube officiels (VOD Hunter)
- Clippe via yt-dlp + ffmpeg en triple format (Clipper)
- Analyse chaque clip via Gemini 2.5 Flash-Lite (Analyzer)
- Génère l'OG image via Pillow (OG Generator)
- Upload sur Cloudflare R2 (0 egress fees)
- Pousse sur Supabase

**Sans intervention humaine.** Nouveau match = clips live dans ~2h.

---

## 🎬 L'experience cible — le "wow" utilisateur

### T+0s — l'arrivée
User arrive sur https://kckills.com. **Le fond est un clip KC qui joue
déjà en loop** : "WE ARE THE CHAMPIONS" voicecomms, ou Rekkles pentakill
Jinx, ou Vladi Viktor 10/1/7. Pas une image statique. Un vrai film qui
respire. Le titre `KCKILLS` massif en or flotte dessus.

### T+3s — la reconnaissance
Le fond change : maintenant c'est Kameto qui fait son discours post-finale
avec la carte info "Le Sacre · Post-match" qui apparaît en bas à gauche.
User comprend : "oh c'est un vrai truc de fan, pas un site générique."

### T+8s — l'exploration
User clique "Scroll les kills". Transition cinématique vers un feed
vertical plein écran. **Un MP4 commence à jouer immédiatement en muted**.
C'est Caliste qui tue Hans Sama. Stats en overlay : "CALISTE → HANS SAMA ·
Aphelios · 32/4/18 · KC 3-0 VIT · Spring 2026 W1". Étoiles en bas à droite.

### T+15s — l'émotion
User swipe up. Deuxième clip : Vladi Viktor 10/1/7 Game 3 vs Caps. Le
split de Pantheon ult qui tue Broken Blade. User double-tap — 5 étoiles
enregistrées. Toast "⭐ 5/5 !".

### T+30s — la connection
Après 5 clips, user reconnaît les noms, les couleurs, les adversaires.
Le site parle sa langue (FR), cite les mêmes mêmes qu'il connaît, montre
les mêmes moments qu'il a vécus en live.

### T+60s — le partage
User clique "Share" sur un clip de Yike qui tue Caps au Grand Final.
Ouvre Discord, colle le lien — Discord embed rich card apparaît avec l'OG
image du kill : "Yike → Caps · Diana · Le Sacre Winter 2025". 5 amis
cliquent dans l'heure.

### T+24h — la viralité
Eto ou Kameto tombe sur le site. Pull up en stream. 10K viewers checkent
le site en live. Le compteur "674 kills" a bougé parce que le worker a
processé le match de la veille. Le chat Discord de KC explose.

---

## 🏆 KPIs (6 mois post-launch)

| KPI | Cible |
|---|---|
| Visiteurs uniques / mois | 50 000+ |
| Temps moyen de session | > 3 min (TikTok benchmark) |
| Bounce rate | < 40% |
| % ratings par visite | 20%+ des users donnent au moins 1 note |
| % commentaires par visite | 5%+ |
| Installs PWA | 10%+ des visites récurrentes |
| Partages Discord + Twitter | 100+ / semaine |
| Clips produits par le worker | 100% des kills LEC KC, 0 intervention |
| Stream mention par Kameto / Eto | 1+ dans les 3 premiers mois |

---

## ✨ Les "obsessions"

Des détails non-négociables qui séparent un site KCKILLS d'un site générique.

### 1. 100% pro-KC
Pas de neutralité fake. Le site est partial. Quand G2 bat KC, l'UI le dit
sombrement. Quand KC gagne, l'UI explose. Les couleurs, les mots, le
sound design — tout célèbre la Karmine Corp.

### 2. Le langage de League of Legends
Palette Hextech (`#010A13` void, `#C8AA6E` gold, `#0AC8B9` cyan) prise
directement du client LoL. Typo Oswald en uppercase pour les titres comme
sur un trailer Riot. Champion splash arts en backgrounds. Icônes de rôle
top/jungle/mid/adc/support. Sous-titre des kills en style commentateur
hypé français.

### 3. Les vrais clips, pas les embeds
Le but final c'est que `/scroll` affiche des **MP4 KC** hébergés sur R2,
pas des iframes YouTube. Le pipeline Python doit fonctionner end-to-end.
C'est ce qui sépare un "site fan" d'un vrai produit.

### 4. L'auto-play silencieux comme TikTok
Quand tu ouvres `/scroll`, ça joue déjà. Pas de bouton "Play". Pas de son.
Swipe pour passer au suivant. Exactement le muscle memory TikTok. Les
utilisateurs ne doivent pas penser — juste consommer.

### 5. Zéro attente
Skeleton screens branded Hextech au lieu d'écrans blancs. Loading states
animés. Pages pré-générées en SSG pour les époques et les joueurs.
Clips chargés en `preload="metadata"` puis upgrade à `"auto"` quand visible
(IntersectionObserver). Next/Image avec priority sur le hero.

### 6. Les narrations émotionnelles
Chaque époque a un `keyMoment` qui raconte vraiment l'histoire — pas
des stats. "Le Sacre" raconte le parcours de la redemption depuis la 10e
place 2024 → lower bracket run → 3e rencontre vs G2 → 3-0 SEC → Vladi
Game 3 Viktor 10/1/7 → Caliste Royal Roader 18 ans. C'est du storytelling,
pas une fiche Wikipedia.

### 7. Les easter eggs
Le Konami Code active "Blue Wall Mode" (gold → blue). Clic 5x sur le
logo KC sort le vrai tweet Macron 2021. URL cachée `/era/darkness` pour
l'époque sombre 2024. Les fans hardcore trouvent ces détails et les
postent en screenshot — effet viral garanti.

### 8. La vitesse de mise à jour
Le worker tourne 24/7. Match fini à 22h → clips live sur le site à 00h30.
Pas de "oh faut attendre que Mehdi upload". Automatique, fiable, rapide.

### 9. La qualité des metadata sociales
Chaque page a un OG image, une description précise, des Twitter Cards,
du JSON-LD structured data. Partager un lien sur Discord, Twitter, Slack
doit toujours donner une carte riche — jamais un preview générique.

### 10. L'accessibilité WCAG AA
Tous les textes > 4.5:1 de contraste. Focus ring visible sur tout ce qui
est focusable. Alt text descriptif ("Canna qui fête sa victoire LEC Winter
2025" pas "player"). Nav clavier complète. prefers-reduced-motion respecté.

---

## 🚫 Ce que KCKILLS N'EST PAS

- ❌ Un site multi-équipes. **Uniquement KC.**
- ❌ Un wiki de stats. On a des stats, mais ce n'est pas le cœur.
- ❌ Un aggregator de news. On cite les articles mais on n'en produit pas.
- ❌ Un site e-commerce merch. Zéro monétisation v0.
- ❌ Un site de paris. Pas de cotes, pas de sponsors betting.
- ❌ Un site neutre. On est pro-KC, assumé.
- ❌ Un outil analytique pour coaches. On vise des fans, pas des pros.
- ❌ Un forum de discussion. On a des commentaires attachés aux kills, mais pas
  des threads génériques.

---

## 🛠️ Stack & infrastructure

| Couche | Choix | Pourquoi |
|---|---|---|
| Frontend | Next.js 15 App Router + React 19 + TS strict | SSR pour SEO, RSC pour perf, l'écosystème est mature |
| UI | Tailwind 4 + shadcn/ui + Framer Motion | Rapide à shipper, composants accessibles, animations state-of-the-art |
| Polices | Oswald / Inter Tight / JetBrains Mono | Display uppercase LoL vibes / body lisible / data tabular |
| Auth | Supabase Auth (Discord OAuth) | La KC Army vit sur Discord, login Discord = 1 click |
| DB | Supabase PostgreSQL + RLS | Free tier 500MB, RLS sécurise par design |
| Storage clips | Cloudflare R2 (custom domain clips.kckills.com) | 10GB free + **0 egress fees** — critique pour un site video |
| Worker | Python asyncio supervisé sur PC local 24/7 | Pas de serveur cloud à payer, contrôle total |
| Analyse IA | Gemini 2.5 Flash-Lite | Free tier 1000 RPD, vidéo input, suffisant pour scorer 100 clips/jour |
| Modération | Claude Haiku 4.5 | $1/M input, <5€/mois |
| Host frontend | Vercel hobby | Free tier, edge network, auto-deploy sur push Git |
| Analytics | Vercel Analytics (+ Plausible self-host plus tard) | Privacy-friendly |
| CI/CD | GitHub + Vercel preview deploys | Auto sur chaque PR |

**Coût opérationnel** : ~10-17 €/mois (domaine + Anthropic + éventuellement Plausible VPS).

---

## 📊 Positionnement compétitif

| | lolesports.com | sheepesports.com | esports.gg | breach.gg | **kckills.com** |
|---|---|---|---|---|---|
| Single-team focus | ❌ | ❌ | ❌ | ❌ | ✅ |
| Cinematic storytelling | ❌ | ❌ | ❌ | Partiel | ✅ |
| Clips TikTok style | ❌ | ❌ | ❌ | ❌ | ✅ |
| Historical depth | Partiel | ✅ | ❌ | ❌ | ✅ (16 eras) |
| Community rating | ❌ | ❌ | ❌ | ❌ | ✅ |
| KC-specific lore | ❌ | ❌ | ❌ | ❌ | ✅ (Blue Wall, Macron, Sacre) |
| Mobile-first PWA | Partiel | ❌ | ❌ | Partiel | ✅ |
| French language | ❌ | ❌ | ❌ | ❌ | ✅ (FR + EN plus tard) |

**Notre edge** : on est le SEUL site qui combine focus single-team + cinematic
storytelling + clips feed TikTok style + pipeline auto 24/7. Les concurrents
font chacun une partie (bien), personne ne fait tout. Cette niche "fan site
qualité pro pour UNE équipe" est ouverte.

---

## 🗺️ Roadmap haute altitude

### Phase 0 — Foundation (fait)
Infrastructure + frontend + data snapshot + déploiement production

### Phase 1 — Content depth (en cours)
- ✅ 16 époques granulaires avec narratives
- ✅ 38 vrais clips YouTube curatés dans Home + era pages
- ✅ 83 matchs réels LEC 2024-2026
- ⏳ Pages alumni (Rekkles, Vladi, Cabochard, Targamas...)
- ⏳ Hall of Fame + achievements
- ⏳ KCX attendance growth timeline
- ⏳ Blue Wall 257 + Dark Era 2024 narratives

### Phase 2 — Pipeline (priorité absolue)
- ⏳ Worker e2e test sur 1 match
- ⏳ Backfill 83 matchs → ~2000 clips MP4 sur R2
- ⏳ Daemon 24/7 auto-processing des nouveaux matchs
- ⏳ `/scroll` affiche les vrais MP4 au lieu des splash arts

### Phase 3 — Community
- ⏳ Rating 1-5 étoiles persisté via Supabase
- ⏳ Commentaires threadés modérés par Haiku
- ⏳ Fan edits section (music videos submitted)
- ⏳ Kill of the week auto
- ⏳ Discord bot qui poste les nouveaux clips
- ⏳ Push notifications PWA

### Phase 4 — Polish & scale
- ⏳ Cmd+K global search
- ⏳ i18n EN version
- ⏳ Lottie pentakill explosions
- ⏳ Lightouse 95+ partout
- ⏳ Sentry + Vercel Analytics
- ⏳ Stream launch chez Eto / Kameto

---

## 📖 Documents connexes

- **[ULTRAPLAN.md](./ULTRAPLAN.md)** — roadmap tactique détaillée par phases (α → μ)
- **[ACTION_GUIDE.md](./ACTION_GUIDE.md)** — guide de setup des comptes/clés API
- **[FEATURES.md](./FEATURES.md)** — tracker des features par status
- **[CLAUDE.md](./CLAUDE.md)** — spec technique complète du produit

---

*"Ce n'est pas juste un site. C'est une lettre d'amour à la Karmine Corp.
Écrite en code, servie en clips."*

— Mehdi & Kairos, 11 avril 2026
