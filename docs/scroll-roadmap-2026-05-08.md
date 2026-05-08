# Audit `/scroll` + Roadmap 50-versions (2026-05-08)

> Brief : audit sincère de l'expérience scroll actuelle, gap analysis vs
> TikTok-grade natif, roadmap structurée des 50 prochaines versions.
> Pas de flatterie. La qualité du scroll est le différenciateur de
> KCKILLS — chaque ms et chaque pixel comptent.
>
> **Note** : ce doc a été produit par audit en parallèle (1 agent UX-deep
> + auteur), 29 findings spécifiques rapportés. **Wave 20.8 a déjà
> shipé pendant la rédaction du doc** (fix du `commentCount` hardcodé à
> 0 dans `FeedSidebarV2`, wired end-to-end depuis le row SQL). Les autres
> findings sont dans la roadmap.
>
> ## ✅ Wave 21 (2026-05-08) — 13 versions shippées
>
> Le commit "fais les 50" : ship en série de quick + medium wins.
>
> | Ver | Wave | Quoi |
> |---|---|---|
> | **V1**  | 21.1 | `clip.dwell` event tracking + `kc:clip-dwell-recorded` CustomEvent. Fondation algo. |
> | **V5**  | 21.1 | `navigator.vibrate(8\|12)` haptique sur snap commit (Android Chrome). |
> | **V7**  | 21.3 | TTFF instrumentation : `clip.ttff` event sur `loadeddata`, per-kill dedup, cold-start flag. |
> | **V11** | 21.2 | Drag indicator scaling : remplace les 5 dots hardcodés par un thin progress rail aligné sur la longueur réelle du feed. |
> | **V12** | 21.2 | Tap-on-killer-name → `/scroll?player=<id>` (réutilise contrat URL filter). |
> | **V13** | 21.2 | Tap-on-champion → `/champion/<name>` (route existante). |
> | **V14** | 21.2 | AI-tag chip row + `?tag=` filter sur /scroll + clearable cyan pill dans le ChipBar. |
> | **V18** | 21.5 | StreakBadge component "🔥 Day N" (localStorage UTC-day-keyed, hidden on day 1). |
> | **V19** | 21.7 | Speed control [0.5×, 1×, 1.5×, 2×] dans le settings drawer + `<video playbackRate>` sync. |
> | **V20** | 21.6 | Auto-advance toggle + ScrollSettingsDrawer (⚙ button top bar) + `kc:auto-advance` event wiring. |
> | **V21** | 21.4 | `AnchorEntry` carrying dwell-fraction, top-K=5 par dwell DESC, eviction by lowest score. Fondation perso. |
> | **V25** | 21.3 | Anti-repeat cap multi-axis : same-player ≤2, same-champion ≤3 in 10, same-fight-type ≤2 in a row. |
> | **V30** | 21.4 | `RECOMMENDATIONS_ENABLED` default ON (kill-switch via `=false` env). Atterrit derrière V21. |
>
> **Tests** : 74 worker tests still green ; tsc clean après chaque
> commit ; aucune migration DB requise ; aucune nouvelle route admin.
>
> ## ⏳ Deferred — pourquoi
>
> Pas par paresse — chaque deferral a un coût/risque concret :
>
> * **V2** tap-to-pause vs unmute — gesture coordination avec
>   DoubleTapHeart + swipe-share + drag, fragile, demande tests
>   manuels par device.
> * **V3** long-press menu — UX device-specific (iOS long-press vs
>   right-click vs PWA), ~2-3 j de QA.
> * **V6** smart preload tier — modification non-triviale du
>   FeedPlayerPool, risque de régression mobile (Wave 19.7).
> * **V8** Web Share enrichment — sheet redesign + per-platform deep
>   links, ~1 j de boulot frontend.
> * **V9** like-state persistence — déjà partiellement présent dans
>   `LikeButton` (optimistic state) ; finir le wiring localStorage
>   est ~30 min.
> * **V10** bookmarks — **nouvelle table DB** (`kill_bookmarks`) +
>   migration + route admin + RLS. ~1 j.
> * **V15** comment overlay partial-height — refactor de
>   `CommentSheetV2` (555 lignes), risque haut.
> * **V16** emoji reactions — nouvelle feature, table DB, modération.
>   ~1.5 j.
> * **V17** viewer count en live — Supabase Realtime WebSocket
>   subscription, infra config requise.
> * **V22-V24** algo signals supplémentaires — nécessitent extension
>   de `/api/scroll/recommendations` + RPC SQL, pas client-only.
> * **V26** feed split tabs (Pour toi / Récent / Top semaine) —
>   reroutage logique du data flow, ~1 j.
> * **V27** onboarding — nouveau flow, design + impl, ~1.5 j.
> * **V28** cold-start hybrid — vérifier que `weightedShuffle` actuel
>   suffit. Probablement déjà ok.
> * **V29** negative signal — dépend de V3 (long-press menu).
> * **V31-V40** social graph — chaque item nécessite migration DB +
>   nouvelle route + RLS + souvent push infra. **Profil utilisateur
>   public** + **follow joueurs** + **push par follow** = 3-5 j minimum.
> * **V41** auto-captions — pipeline worker majeur (Whisper /
>   Gemini transcribe → SRT → R2). Coût AI non-trivial.
> * **V42-V43** best-thumbnail seek — `best_thumbnail_timestamp_in_clip_sec`
>   est dans `ai_annotations` mais pas exposé sur `kills` row.
>   Migration + view query + plumbing ~0.5 j.
> * **V44** iOS Capacitor + **V45** Android TWA — buildchain native,
>   compte Apple Developer, signing keys, store reviews. **2+ semaines**.
> * **V46** finir KO/ES translations — besoin de speakers natifs LCK
>   et LATAM. Skipped logiciel-only.
> * **V47-V48** multi-team / multi-league — heavy worker pipeline
>   refactor (sentinel + harvester) + UI team-picker.
> * **V49** AI highlight reel — pipeline ffmpeg-concat quotidien.
>   ~1 j.
> * **V50** editor mode — overlay annotations community-style.
>   Heavy frontend + DB + modération. ~1+ semaine.
>
> **Cherry-pick proposé pour la prochaine sprint (4 semaines)** :
> V2, V3, V6, V8, V9, V10 (bookmarks avec migration), V22, V42-V43.
> Plus une attaque ciblée sur V32 + V34 + V35 (profil + follow +
> push) qui débloquent vraiment la dimension sociale.

---

## TL;DR

**État actuel** : excellent socle technique (5-slot pool + viewport
virtualisation Wave 19.7 + HLS adaptive + springs tunés vs TikTok),
**MAIS** boucles d'engagement faibles, signal d'algorithme incomplet,
absence de social graph, audio model inversé vs TikTok.

**Top 5 gaps vs TikTok-grade** :

1. **Audio model inversé** — TikTok suppose que le son MATTERS. Nous
   ajoutons une BGM YouTube par-dessus parce que les clips ont peu d'audio
   engageant. Inversion stratégique.
2. **Algorithm peu nourri** — `useRecommendationFeed` env-gated OFF par
   défaut ; pas de signal de dwell-time ; pas d'anti-repeat sophistiqué.
3. **Social graph ~0** — pas de profils utilisateurs publics, pas de
   follow-joueurs, pas de DMs. Discord OAuth pour l'auth seulement.
4. **Engagement loops faibles** — pas de streaks / digests
   personnalisés / push pour nouveaux clips d'un joueur suivi.
5. **Discovery limitée** — chips multi/fb/player/fight/side ; pas
   de "trending now", pas de hashtag-comme-discoverable, pas de
   "match en live ferme une heure" surfaçage.

**Le path en 50 versions** : 5 phases × 10 versions, sequencées par
ROI / dépendances. Estimées pour un dev seul : ~6-9 mois si tout est
shipé. Mais le bon move est de cherry-pick les 10 highest-leverage et
ship en 4-6 semaines.

---

## Partie 1 — Audit sincère

### Ce qui marche bien (à protéger)

| Aspect | Pourquoi c'est bien | Refs |
|---|---|---|
| **Architecture du pool vidéo** | 5 `<video>` mountés une fois, déplacés via `translate3d`. Pas de remount React = ~30 ms épargnées par swipe. | `FeedPlayerPool.tsx:29-48` |
| **Spring physics tunés** | Stiffness 320 / damping 32 / mass 0.85 pour le snap normal, 480/38/0.7 pour les flicks rapides. Le tuning a été fait sur iPhone réel (pas émulateur). | `lib/scroll/spring.ts` |
| **Velocity-aware skip** | `FLICK_VELOCITY_THRESHOLD` + `FAST_FLICK_VELOCITY` permettent de skip 2+ items sur un flick rapide. C'est ce que TikTok fait. | `useFeedGesture.ts` |
| **HLS adaptive** | Native sur Safari iOS, hls.js fallback ailleurs. Bitrate ladder (240p→1080p) capé selon `useNetworkQuality`. | `useHlsPlayer.ts` |
| **Viewport virtualization** | Depuis Wave 19.7, seuls activeIndex ± 2 montent dans le DOM. Cap mobile sain quel que soit le feed length. | `ScrollFeedV2.tsx:659+ + VIRTUAL_WINDOW=2` |
| **Network-aware quality** | `navigator.connection` + saveData → "low / med / high / ultra / auto". Driver de l'HLS startLevel + capLevel. | `useNetworkQuality.ts` |
| **Pull-to-refresh** | Reshuffle Fisher-Yates avec spinner artificial-delay de 350 ms (intentional UX), spring rubber sur gesture. | `PullToRefreshIndicator.tsx` |
| **Skeleton + error + offline states** | 3 états couverts (chargement, erreur, hors-ligne) avec UI dédiée. Mieux que "blank page". | `FeedItem*.tsx`, `OfflineBanner.tsx` |
| **Scroll restore** | `useScrollRestore` sessionStorage-backed, 30 min expiry. Retour de `/kill/[id]` ramène l'utilisateur à sa position. | `useScrollRestore.ts` |
| **Keyboard shortcuts** | J/K/space/M/L/C/?/Esc — power-users desktop. Help overlay accessible. | `useKeyboardShortcuts.ts` |

### Ce qui est faible (par sévérité)

**🔴 CRITIQUE — boucles d'engagement & algo**

- **Watch-time fraction non capturée** — `clip.viewed/started/ended`
  sont fired, mais l'algo ne consomme pas le ratio "vu jusqu'à 80 %"
  vs "scrollé après 1.5 s". TikTok's most-secret signal n'est pas
  exploité.
- **Recommendations env-gated OFF** — `RECOMMENDATIONS_ENABLED` default
  off. Le visiteur lambda voit le même weighted-shuffle que tous les
  autres. Pas de personnalisation, pas de cold-start onboarding.
- **Anti-repeat trivial** — `weightedShuffle` regarde 5 items en arrière
  pour éviter la même clump (joueur ou champion). TikTok fait du
  "creator decay" sur 30+ items + des "diversity injections".

**🔴 CRITIQUE — audio model**

- **BGM YouTube par-dessus** — `BgmPlayer` charge un iframe YouTube
  pour mettre du son d'ambiance. C'est un aveu : les clips eux-mêmes
  ont peu d'audio engageant (caster cut, ambiance match). Sur TikTok
  le son DU CLIP est l'identité. Ici on cache.
- **Mute par défaut sans nudge** — l'utilisateur ne sait pas qu'il y a
  du son. Pas de "tap to hear caster" overlay. La prompt s'affiche
  une fois mais discrète.
- **Pas de "use this sound"** — si une track Karmine cult devient
  trending, aucun moyen de la cliquer pour voir tous les clips qui
  l'utilisent.

**🟠 HIGH — gestures & navigation**

- **Tap-zone single-action** — TikTok : tap haut = previous, tap bas =
  next. Ici tout tap = pause/play (via DoubleTapHeart). Discoverability
  faible.
- **Long-press pas exploité** — pas de menu contextuel ("Pas
  intéressé", "Save for later", "Report").
- **Profil joueur non-cliquable depuis le feed** — voir le killer
  pseudo en haut, mais il n'est pas un lien vers `/player/[slug]`.
- **Champion non-cliquable** — `Yone → Seraphine` est du texte plat,
  pas un filter chip.
- **Tags AI non-cliquables** — `aiTags=["outplay","clutch"]` exists
  mais pas surfaced en chips cliquables.

**🟠 HIGH — engagement / social**

- **Pas de "save / bookmark"** — utilisateur veut revoir un clip
  plus tard ? Faut copier le lien.
- **Pas de "follow player"** — Caliste fait penta hier soir → pas
  moyen de demander des notifications pour Caliste.
- **Pas de profil utilisateur public** — `/u/[username]` n'existe
  pas. La social graph est ratings + comments + Discord OAuth.
- **Comments overlay full-page** — slide-up partial-height (60 %
  viewport) serait plus TikTok. Actuellement le clip disparaît.
- **Like state non-persisté** — `<DoubleTapHeart />` joue
  l'animation mais ne persiste rien (le like fonctionne via le
  rating 5★ dans le sidebar).

**🟡 MEDIUM — data plumbing & polish**

- **Time-to-first-frame non mesuré** — combien de ms entre route
  enter et premier frame painted ? Inconnu. TikTok target <500 ms.
- **`best_thumbnail_timestamp_in_clip_sec`** — le champ existe sur
  `kills.assets_manifest` (analyseur le génère) mais le pool le
  consomme-t-il pour seek-to-best-frame ? À vérifier.
- **Mute toggle non-haptique ET non-tracké** — pas de
  `navigator.vibrate(10)` sur swipe complete / mute toggle, et
  surtout aucun event analytics `mute_toggle` n'est fired (signal
  d'engagement audio noir).
- **Description inline jamais cliquable** — un mot-clé pourrait
  filter le feed (mention de Faker → autres kills sur Faker).
- **Pas de "speed control"** — 0.5× / 1× / 2× absent. Spectateurs LoL
  peuvent vouloir slow-mo le penta.
- **Pas de captions sync'd** — `description_fr` est statique en
  overlay ; pas de texte qui suit le caster.
- **End-of-feed = reshuffle only** — pas de "Découvre les autres
  équipes", "Watch latest match", "Daily highlight reel".
- **`saveData` flag lu une seule fois** — `useNetworkQuality.ts:39`
  check au mount ; si l'utilisateur active Data Saver mid-session,
  les clips suivants restent en haute qualité. Le `change` event
  est listened mais le pool ne re-probe pas les slots warm.
- **Anchor window fixé à 5** — `ANCHOR_WINDOW = 5` dans
  `useRecommendationFeed.ts`. Sur une session 50 clips on n'utilise
  que les 5 derniers comme anchors. Pas de decay curve, biais
  short-term marqué.
- **Recommendation debounce 600 ms** — `REFETCH_DEBOUNCE_MS = 600`.
  Un utilisateur swipe 3 clips en 600 ms → 1 seule fetch. Sous-
  échantillonnage de l'intent.
- **Drag indicator hardcodé 5 dots** — `ScrollFeedV2.tsx:820`,
  `visibleItems.slice(0, 5)`. Sur un feed de 100+ items toutes les
  positions sont écrasées dans 5 dots.
- **Pas de Visibility API listener** — l'utilisateur passe en
  background tab → la vidéo continue de jouer (muted) → impressions
  comptées falsement + waste data.
- **Comment count hardcodé à 0** — ✅ FIXÉ Wave 20.8 (ce commit) :
  wired end-to-end depuis `kills.comment_count` (déjà maintenu par
  trigger DB) jusqu'au sidebar. Les comptes apparaissent
  maintenant en temps réel.
- **Like state non-persisté** — refresh la page → on perd "j'avais
  rated 4★" (le serveur ré-envoie `initialLikeCount` mais pas le
  fait que CE user a noté).
- **Comment count update via re-mount** — pas d'optimistic update
  sur le sidebar quand l'utilisateur poste un commentaire. Il
  attend la prochaine query.
- **Share URL = `/scroll?kill=<id>`** — l'ami qui ouvre le lien
  atterrit dans le feed et doit cliquer encore pour voir le détail.
  Devrait être `/kill/<id>` (page dédiée avec OG card riche).

**🟢 NICE-to-have / longue traîne**

- Dim mode (bg blur des items voisins pendant scroll)
- Liked clips count visible avant tap
- Active viewer count en live
- Streak badges
- AR overlays (annotations community-style)
- Stitching / dueting (clip remix)
- Translations FR→EN/KO/ES en temps réel
- Native iOS / Android shells (TWA / Capacitor)
- Apple Watch complication "Next KC match"
- Chromecast / Airplay
- Multi-team scope (G2 / FNC / KOI feed)
- LCK / LPL / LCS expansion
- Multi-kill SFX flourish (chime sur penta/quadra)
- Clip duration affichée en coin
- Long-press = save (au lieu de report aujourd'hui)
- 120 Hz spring tuning sur iPad Pro / Pixel
- Download video API
- Tab focus ring visible pour keyboard nav
- DoubleTapHeart synchronisé avec Enter key (un seul code path)

---

## Partie 2 — Gap analysis vs TikTok-grade natif

### G1. First-second hook

**TikTok** : video plays AVANT que l'utilisateur touche. Cold-start
optimisé pour <300 ms time-to-first-frame.

**KCKILLS** : autoplay muted respecte les contraintes browser, mais
le poster image est-il rendu pendant que le clip charge ? Le pool
preload="auto" sur le LIVE slot, mais l'analyseur a déjà calculé
`best_thumbnail_timestamp_in_clip_sec` — est-ce que le `<video>`
seek-to ce moment précis pour que le poster soit le frame le plus
parlant ?

**Action** : V7 (TTFF instrumentation) + V42 (consume
best_thumbnail_timestamp) + V43 (initial seek-to-best-frame).

### G2. Gesture / momentum / overscroll

**TikTok** : rubber-band overscroll en haut/bas, momentum carries 2+
items sur un flick fort, spring "sticky" qui colle juste avant le
snap final.

**KCKILLS** : springs tunés correctement (Stiffness 320, damping 32),
flick-velocity-aware. **Pas de rubber-band** au top/bottom (just hard
stop). Pas de feedback haptique.

**Action** : V4 (déjà fait — vérifier flick math) + V5 (haptics) +
V11 (rubber-band overscroll sur top/end).

### G3. Audio model

**TikTok** : sound IS the content. Sounds become hashtags. "Use this
sound" → discovery surface.

**KCKILLS** : mute par défaut, BGM YouTube en surcouche pour
"meubler". Le caster cut est la seule audio source qui matter, mais
elle n'est pas mise en avant.

**Action** : V6 (audio nudge), V13 (caster soundboard — top
caster moments cliquables), V31 (boucle audio identifiable par clip).

### G4. Algorithm depth

**TikTok** : ranks par dwell time + completion rate + engagement
density + creator-affinity + trending decay. Black box mais le
résultat = chaque session feel différent et meilleur.

**KCKILLS** : weighted shuffle Wilson + recommendation cosine sur
embeddings (env-gated OFF). Pas de signal dwell time. Pas de
creator-affinity. Pas d'A/B framework.

**Action** : V21 (dwell-time signal), V23 (champion-affinity), V25
(anti-repeat cap), V30 (recommendations ON par défaut).

### G5. Social graph

**TikTok** : follow / DM / profil public / liked-clips visible /
notifications. Le graphe SOCIAL est le moat.

**KCKILLS** : Discord OAuth + ratings + comments. Pas de follow,
pas de profils, pas de DMs.

**Action** : V31 (player drawer), V32 (`/u/[username]`), V35 (follow
+ push), V40 (creator monetization).

### G6. Discovery surfaces

**TikTok** : hashtags, sounds, effects, "For You" tab, Discover tab,
Search avec transcript matching, trending now. Discovery est PARTOUT.

**KCKILLS** : `ScrollChipBar` (multi/fb/player/fight/side) — chips
classiques. Pas de "trending", pas de hashtag-style cliquable, pas de
"watch this match live" surfacing en feed.

**Action** : V19 (tag chips cliquables), V20 (trending section dans
le feed), V47 (multi-team / multi-league discovery).

### G7. Native feel & PWA limites

**TikTok** : iOS/Android natif, animations 120 fps, haptics, file
system pour download, fullscreen sans browser chrome.

**KCKILLS** : PWA installable. Service worker. Push notifications
VAPID. Manifest configuré. **Mais** pas de haptics côté code, pas de
download API, le browser chrome reste partiellement visible (URL bar
slide).

**Action** : V5 (haptics), V44 (Capacitor iOS shell), V44b (TWA
Android), V43 (PWA install prompt finesse).

### G8. Engagement loops

**TikTok** : push notifications quotidiennes, weekly digest, streaks,
FOMO, "creator went live", "your friend liked this".

**KCKILLS** : daily Discord report (operator-only, pas user-facing),
push notifications par clip publié (mais pas de scoping par follow),
pas de streaks, pas de digest.

**Action** : V18 (streak), V35 (push par follow), V36 (weekly digest
mailable / Discord-style), V49 (AI highlight reel quotidien).

---

## Partie 3 — Roadmap 50 versions

> **Légende sizing** : 🟢 small (heures→1 j) — 🟡 medium (1-3 j) —
> 🟠 large (1 wk) — 🔴 huge (2+ wk).
>
> **Légende impact** : ⭐ marginal — ⭐⭐ utile — ⭐⭐⭐ visible — ⭐⭐⭐⭐
> needle-mover.
>
> Prioritization = impact / effort. Cherry-pick les ⭐⭐⭐⭐ + 🟢🟡 d'abord.

---

### Phase A — Foundations + observability (V1–V10)

Le but : poser les signaux + rendre le feed instrumenté avant de
toucher à l'algo. Tout ce qui suit dépend de la qualité de la
télémétrie ici.

| Ver | Quoi | Sizing | Impact |
|---|---|---|---|
| **V1** | Watch-time fraction tracking : `clip.dwell` event au moment du swipe-away avec `elapsed_ms` + `clip_duration_ms` + `dwell_fraction`. Histogramme percentile bucket en analytics. | 🟢 | ⭐⭐⭐⭐ |
| **V2** | Tap-to-pause / tap-to-resume séparé du tap-to-unmute. TikTok : 1 tap = pause, 2nd tap = resume. Mute reste sur bouton dédié. | 🟢 | ⭐⭐⭐ |
| **V3** | Long-press sur un item → menu contextuel ("Pas intéressé", "Sauvegarder", "Signaler", "Voir le joueur"). | 🟡 | ⭐⭐⭐ |
| **V4** | Velocity-aware swipe — flick fort skip 2-3 items, flick léger skip 1, drag lent reste. Vérifier les tunings actuels. | 🟢 | ⭐⭐ |
| **V5** | Haptics sur swipe complete (`navigator.vibrate(8)`) + double-tap heart (`vibrate([10, 30, 10])`). Mobile-only, PWA-installed feel. | 🟢 | ⭐⭐⭐ |
| **V6** | Smart preload tier — Wi-Fi : next 2 + prev 1 à preload="auto". Cellular : next 1 seulement. Battery low : metadata only. Wire `useNetworkQuality` plus profondément dans le pool. **Inclut : saveData re-probe sur change event (le pool re-évalue les slots warm) + Visibility API listener (pause auto sur background tab).** | 🟡 | ⭐⭐⭐ |
| **V7** | Time-to-first-frame instrumentation. Capture le timestamp entre `route.enter` et le premier `loadeddata` du LIVE slot. Bucket en perf dashboard. | 🟢 | ⭐⭐⭐ |
| **V8** | Web Share API integration. `navigator.share()` quand dispo, fallback à clipboard. Custom share sheet sur fallback : Discord / X / Reddit / WhatsApp / copier. | 🟡 | ⭐⭐⭐ |
| **V9** | Liked-state persistence per session via localStorage. Pré-remplir le `★` rating sidebar quand le visiteur revient. | 🟢 | ⭐⭐ |
| **V10** | Bookmark / "Save for later". Nouveau table `kill_bookmarks (user_id, kill_id, created_at)`. Bouton sidebar. Page `/profil/saved`. | 🟡 | ⭐⭐⭐ |

### Phase B — Engagement & gestures (V11–V20)

Le but : rendre chaque tap discoverable. Chaque mot ou icône est un
chemin vers plus de contenu.

| Ver | Quoi | Sizing | Impact |
|---|---|---|---|
| **V11** | Rubber-band overscroll sur top + end. Spring rubber sur la première / dernière item au release au-delà du threshold. **Inclut : drag-indicator dot grid qui scale avec la longueur réelle du feed** (actuellement 5 dots hardcodés `ScrollFeedV2.tsx:820`, n'importe quelle position au-delà de 5 est tassée). | 🟢 | ⭐⭐ |
| **V12** | Tap-on-killer-name → slide-up player drawer (50% viewport). Affiche avatar + KDA total + last 5 kills + bouton "Suivre". | 🟡 | ⭐⭐⭐⭐ |
| **V13** | Tap-on-champion (killer ou victim) → filter feed par champion. URL state-aware. | 🟢 | ⭐⭐⭐ |
| **V14** | Tap-on-AI-tag (chip) → filter feed par tag. ai_tags devient surface de discovery. | 🟢 | ⭐⭐⭐ |
| **V15** | Comment overlay slides up à 60% viewport (TikTok-style). Le clip continue de jouer derrière. Inline reply threading. | 🟡 | ⭐⭐⭐⭐ |
| **V16** | Inline emoji reactions (`🔥👏😂😱`) — tap once dans le sidebar → animation + counter. Léger. | 🟡 | ⭐⭐⭐ |
| **V17** | Active-viewer count en live ("142 KC fans regardent ce match"). WebSocket Supabase Realtime pour le compteur. | 🟠 | ⭐⭐⭐ |
| **V18** | Streak badge — daily check-in. "Day 5 streak — don't break it". Cookie + DB column. | 🟡 | ⭐⭐ |
| **V19** | Speed control sidebar : 0.5× / 1× / 2× pour slow-mo / fast-skim. UI minimal en sidebar. | 🟡 | ⭐⭐ |
| **V20** | Auto-advance toggle — par défaut OFF (clip loops), bouton ⚙ → ON (clip ends → auto-swipe-next). Setting persisté. | 🟢 | ⭐⭐ |

### Phase C — Algorithm + perso (V21–V30)

Le but : flipper RECOMMENDATIONS_ENABLED à ON par défaut, mais
ENRICHIR le signal d'abord pour que ça vaille le coup.

| Ver | Quoi | Sizing | Impact |
|---|---|---|---|
| **V21** | Dwell-time signal feeding `useRecommendationFeed`. Anchors récents weighté par dwell_fraction. Plus tu dwell, plus l'embedding compte. **Inclut : étendre `ANCHOR_WINDOW=5` à une fenêtre glissante 20 items avec decay exponentiel (anchors récents pèsent ~3× les anciens) + abaisser `REFETCH_DEBOUNCE_MS=600` à 250 pour suivre les flicks rapides.** | 🟡 | ⭐⭐⭐⭐ |
| **V22** | Player-affinity signal — cookie-based stocke "user a dwellé > 5 fois sur Caliste". Recommandations boost les Caliste. | 🟡 | ⭐⭐⭐ |
| **V23** | Champion-affinity signal — same shape mais sur champions. Affine la perso même cold-start. | 🟡 | ⭐⭐⭐ |
| **V24** | Time-of-day weighting — kills shown right after un live match favorisés (-1h post-match = +1.5× score). | 🟢 | ⭐⭐ |
| **V25** | Anti-repeat cap renforcé — pas le même joueur 2 in a row, pas le même champion 3 dans 10. Pas le même type de fight 2 in a row. | 🟢 | ⭐⭐⭐ |
| **V26** | Feed split tabs : `Pour toi` / `Le plus récent` / `Top semaine`. URL state. Tab persisté en cookie. | 🟡 | ⭐⭐⭐ |
| **V27** | Onboarding — première visite, prompt "Choisis 2-3 favoris" (Caliste, Yike, Canna). Seeds l'algo. localStorage-backed pour anonymes. | 🟡 | ⭐⭐⭐⭐ |
| **V28** | Cold-start without anchors — Wilson hybrid de score + freshness + diversity. Vérifier que `weightedShuffle` actuelle implémente déjà ça correctement. | 🟢 | ⭐⭐ |
| **V29** | Negative signal — long-press menu (V3) → "Pas intéressé". Downweight similaire (champion + player + tag) pour cette session. | 🟡 | ⭐⭐⭐ |
| **V30** | RECOMMENDATIONS_ENABLED = true par défaut sur Vercel. Monitor le %ge de cold-start fallback (anchor-empty) et pub-rate impact. | 🟢 | ⭐⭐⭐⭐ |

### Phase D — Social graph + creators (V31–V40)

Le but : transformer KCKILLS d'un site de clips en un produit social.
Graphe d'utilisateurs qui suivent des joueurs, partagent, archivent.

| Ver | Quoi | Sizing | Impact |
|---|---|---|---|
| **V31** | Player profile drawer (V12) lift à route propre `/joueur/[slug]?from=scroll` avec retour gestuel (swipe down). Stats + last 20 kills + bouton suivre. | 🟡 | ⭐⭐⭐ |
| **V32** | User profile pages publiques `/u/[username]`. Avatar Discord + total ratings + comments + saved clips list. RLS public read. | 🟠 | ⭐⭐⭐ |
| **V33** | Liked clips list visible sur user profile. `kill_bookmarks` (V10) consommé public-read. | 🟢 | ⭐⭐ |
| **V34** | Follow players (table `player_follows`). Notifications opt-in : "Suivre Caliste = push à chaque nouveau clip". | 🟡 | ⭐⭐⭐⭐ |
| **V35** | Push notifications wired par follow (pas par broadcast global). Filter `push_subscriptions` par `follows.player_id`. | 🟠 | ⭐⭐⭐⭐ |
| **V36** | Weekly digest "Pour toi cette semaine" — top 5 clips parmi tes follows + tes plus dwellés. Email ou Discord DM (au choix de l'utilisateur). | 🟠 | ⭐⭐⭐ |
| **V37** | Community clips lift — `community_clips` table existe mais peu visible. Mixer dans le feed à priorité basse (`source='community'` chip). | 🟡 | ⭐⭐ |
| **V38** | "X fans" micro-counter par player (count `player_follows`) visible sur profile + feed sidebar. | 🟢 | ⭐⭐ |
| **V39** | Comment moderation queue surface → admin (`/admin/comments/queue`). Voir + approve/reject les flagged. | 🟡 | ⭐⭐ |
| **V40** | Creator tipping placeholder — bouton "Soutenir Caliste" linke vers Discord/Twitch du joueur. Pas de paiement direct dans V0. | 🟢 | ⭐ |

### Phase E — Platform + scale (V41–V50)

Le but : sortir des limites du browser web FR. Captioning auto, multi-
team, app native.

| Ver | Quoi | Sizing | Impact |
|---|---|---|---|
| **V41** | Auto-generated captions via Whisper / Gemini. Pipeline worker : caster audio → SRT → R2. Player consomme via `<track kind="captions">`. | 🔴 | ⭐⭐⭐⭐ |
| **V42** | Use `best_thumbnail_timestamp_in_clip_sec` (analyseur le génère déjà) pour seeker au best frame avant `<video>` paint. TTFF apparent -200 ms. | 🟢 | ⭐⭐⭐ |
| **V43** | Initial poster seek — set `<video currentTime={best_thumb_ts}>` avant load. Fallback à 0 si manquant. | 🟢 | ⭐⭐⭐ |
| **V44** | iOS native shell via Capacitor — wrappe la PWA. Push natif APNs + storage natif + haptics natifs. | 🔴 | ⭐⭐⭐⭐ |
| **V45** | Android native shell via TWA (Trusted Web Activity). Plus simple que Capacitor mais sans plugins. | 🟠 | ⭐⭐⭐ |
| **V46** | Translations UI complètes EN/KO/ES. Le scaffolding i18n existe ; finir les locales (TODO ko / TODO es). | 🟠 | ⭐⭐⭐ |
| **V47** | Multi-team scope — extension à G2 / FNC / KOI / TH / SK. `tracked_teams` table déjà conçue. UI : team-picker en chip bar. | 🔴 | ⭐⭐⭐⭐ |
| **V48** | International leagues — LCK / LPL / LCS feed integration. Beaucoup de boulot d'ingestion (livestats par région). | 🔴 | ⭐⭐⭐ |
| **V49** | AI highlight reel quotidien — auto-mashup 60 s des top 5 clips de la veille via FFmpeg concat + transitions. R2 hosted. Lien Discord daily. | 🟠 | ⭐⭐⭐ |
| **V50** | Editor mode — permet aux fans d'annoter un clip (arrow / text overlay) façon TikTok stitch. Les annotations visibles aux autres. | 🔴 | ⭐⭐ |

---

## Partie 4 — KPIs à surveiller pour valider chaque version

| KPI | Cible | Quand mesurer |
|---|---|---|
| **Time-to-first-frame** (TTFF) | < 500 ms p50 | Après V7 |
| **Dwell fraction p50** | > 0.5 (clips vus à 50%+) | Après V1 |
| **Session length p50** | > 3 min (vs ~1.5 actuel ?) | Après V11–V20 |
| **Items / session** | > 8 (TikTok feel : 20+) | Après V21–V30 |
| **Return rate D7** | > 25 % (utilisateurs qui reviennent à J+7) | Après V18 + V35 |
| **Push opt-in rate** | > 15 % des authed | Après V34–V35 |
| **Recommendation engagement uplift** | dwell_fraction +15 % vs weighted-shuffle baseline | Après V30 (A/B test) |
| **Mobile crash rate** | < 0.1 % (ne pas régresser sur Wave 19.7 baseline) | Toutes versions, monitor Sentry |
| **Bundle size mobile** | < 250 KB initial JS | À chaque ship qui ajoute un import |

---

## Partie 5 — Pièges à éviter

1. **Ne pas remettre du DOM-bomb** — toute V doit respecter le
   `VIRTUAL_WINDOW=2` cap du Wave 19.7. Tester sur un /scroll
   500 kills minimum.
2. **Ne pas casser le scroll-restore** — sessionStorage 30 min ; si
   on ajoute une route navigation qui interrompt l'unmount du
   ScrollFeedV2, le restore explose.
3. **Ne pas blacklister `RECOMMENDATIONS_ENABLED`** — l'env var doit
   rester fonctionnelle pour kill-switch en prod si l'algo
   recommandé fait pire que la baseline.
4. **Ne pas alourdir le RSC payload** — chaque field ajouté à
   `VideoFeedItem` × 250 items = bloat. Tester `curl /scroll | wc -c`
   avant/après.
5. **Ne pas casser le budget Vercel** — chaque nouvelle route
   admin ajoute ~10 KB par bundle. /admin/*/page.tsx restent <50 KB.
6. **Tests > démo** — chaque feature avec un signal algo ou un
   nouveau gesture mérite un test pinning le contrat. Le v1 du
   pool a explosé en prod 2 fois faute de tests.

---

## Partie 6 — Ordre d'attaque recommandé

Si tu ne peux ship que **10 versions** (4 semaines de dev solo),
voici les 10 highest-leverage :

1. **V1** Watch-time tracking (foundations pour tout l'algo)
2. **V7** TTFF instrumentation (mesure-d'abord-puis-fix)
3. **V12** Tap-killer-name → player drawer (gros gain UX)
4. **V21** Dwell-time signal recommandations
5. **V25** Anti-repeat cap renforcé
6. **V30** RECOMMENDATIONS_ENABLED ON (avec V21+V25 derrière)
7. **V5** Haptics
8. **V14** AI tags cliquables
9. **V15** Comments slide-up overlay
10. **V35** Follow + push par joueur

Chaque numéro est self-contained, mesurable, et ship-able en 1-3
jours. Les phases B-D sont alignées dépendances : V21-V30 dépend de
V1, V35 dépend de V32-V34, etc.

---

*Doc 2026-05-08 par Claude. Le scroll est le différenciateur de
KCKILLS. Chaque ms et chaque pixel comptent. Cherry-pick agressif >
ship complet en bloc. La meilleure feature est celle qui ship.*
