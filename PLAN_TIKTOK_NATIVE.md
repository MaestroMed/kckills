# PLAN — Passer `/scroll` en TikTok-native

> Statut : draft v1, 18 avril 2026
> Cible : remplacer le scroll "TikTok-shaped" actuel par une expérience qui tient la comparaison directe avec l'app TikTok native sur mobile (iOS/Android via PWA + desktop fallback).
> Compatible avec le pivot Kameto VOD-only (qui multipliera le catalogue par ~10x).

---

## 0. Décisions structurantes à valider AVANT de coder

Ces 6 choix architecturaux conditionnent tout le reste. Si tu hésites, on figeera ensemble avant d'attaquer la Phase 1.

| # | Décision | Recommandation | Pourquoi |
|---|---|---|---|
| D1 | **Player pool : 3 ou 5 elements ?** | **5** | 1 actif + 2 préchargés en avant + 2 en arrière. Permet swipe rapide bidir sans blink. |
| D2 | **Format vidéo : HLS, DASH, ou MP4 progressif ?** | **HLS** (hls.js) | Meilleur support iOS natif (Safari lit HLS direct, pas besoin de hls.js sur iOS). Switch bitrate fluide. ~30 KB JS sur Android. |
| D3 | **Gesture engine : framer-motion, useGesture ou raw ?** | **`@use-gesture/react` + `framer-motion`** | useGesture pour la détection vélocité/direction, framer-motion pour les anims interpolées (spring physics). ~25 KB total, batt-tested. |
| D4 | **Virtualization : custom ou TanStack Virtual ?** | **Custom léger** | TanStack Virtual = 6 KB mais pensé liste classique. Pour un snap-feed full-screen avec pool de videos, du custom 200 lignes est plus précis. |
| D5 | **End-of-feed : loop, recommendation ou "fin" ?** | **Loop sur top-N + recommendation chip** | Génère pas de sentiment de "fin de catalogue", redirige vers /best ou /multikills via une carte fin-de-feed. |
| D6 | **Migration : big bang ou route en parallèle ?** | **Route en parallèle `/scroll-v2` puis swap** | Permet de comparer côte-à-côte, A/B test si on veut. Swap quand /scroll-v2 dépasse /scroll sur tous les axes. |

---

## 1. Vision cible — qu'est-ce que "TikTok-native" veut dire concrètement ?

### 1.1 Sur mobile (iOS Safari + Android Chrome PWA)

- **Glisse fluide doigt-driven** : le clip suit littéralement le doigt pendant le drag, snap au release avec spring physics (overshoot doux)
- **Vélocité-aware** : flick rapide vers le haut = skip 1 ou 2 clips d'un coup ; drag lent = un seul snap
- **Zéro frame skipping** : le clip suivant joue déjà à l'instant où le snap se finit, pas 200ms de poster figé
- **Audio context unmute au premier swipe**, persisté
- **Web Share API** sur le bouton share → ouvre le share sheet natif iOS/Android
- **Pull-to-refresh en haut du feed** → re-shuffle (pas un nouveau pull DB, juste un resort + nouveau seed random)
- **Buffer 5+ clips en avant** en background pendant l'idle (sans bouffer la 4G en lecture active)
- **Adaptive bitrate** : si le réseau drop, le clip courant switch à une variante low sans interrompre la lecture
- **Mémoire bornée** : 5 video elements max montés en même temps quel que soit le nombre de clips dans le feed (1, 200, 10000)
- **Latence first-frame < 300ms** sur réseau 4G médian

### 1.2 Sur desktop

- **Mouse wheel scroll** déclenche les mêmes snaps que le swipe
- **Keyboard shortcuts** : ↑↓ navigate, Espace pause, M mute, J/K next/prev, L like, C comment
- **Hover-pause** comme sur TikTok web
- **Carte side-by-side option** quand viewport > 1600px (clip + comments rail visible en permanence)
- **Sound on by default** sur desktop (pas de souci d'autoplay policy une fois la première interaction faite)

### 1.3 Critères de succès mesurables

À atteindre en fin de chantier :

| Métrique | Aujourd'hui | Cible TikTok-native |
|---|---|---|
| First-frame latency (4G médian) | ~800ms | < 300ms |
| Memory per 100 clips (mobile Safari) | ~250 MB | < 80 MB |
| Bundle `/scroll` First Load JS | 125 KB | < 180 KB (acceptable l'augmentation) |
| Time to first paint (LCP) | ~2.1s | < 1.5s |
| Inter-clip swap (perceived) | snap dur | spring 280ms |
| Frames dropped pendant swipe | nm | 0 sur 60Hz |
| Lighthouse Performance mobile | ~75 | > 90 |
| Web Share natif | non | oui |
| Pull-to-refresh | non | oui |

---

## 2. Inventaire de l'écart actuel → cible

### 2.1 Ce qu'on garde tel quel

- ScrollFeed.tsx **structure générale** : items[] → mapping vers `<VideoScrollItem>` / `<MomentScrollItem>` / `<AggregateScrollItem>`
- **Filter chips** (ScrollChipBar.tsx) : zéro changement
- **Empty state chip-aware** : zéro changement
- **URL state `?kill=<id>`** via replaceState : conservé, le nouveau player pool écrira le même param
- **Right sidebar actions** (rate, share, comment) : conservé, on remplace juste le bouton share par Web Share API
- **Comments panel** : conservé
- **Server-side data layer** (`/scroll/page.tsx` + chip filter logic) : zéro changement
- **Toutes les autres pages** (`/best`, `/multikills`, `/match/[slug]`, etc.) : zéro changement

### 2.2 Ce qu'on remplace

- **`useScrollAutoplay` hook** : remplacé par `useFeedPlayer` (pool-aware, plus de 1 video par item)
- **CSS `scroll-snap-mandatory`** : remplacé par un controller gesture+animation
- **`<video>` per item** : remplacé par 5 video elements partagés via portal/teleport
- **`<video src=mp4>`** : remplacé par hls.js attachable selon le device
- **`useEffect` de chargement preload** : remplacé par un buffer manager centralisé
- **Bouton share inline** : remplacé par Web Share API + fallback URL copy

### 2.3 Ce qu'on ajoute

- Pool manager (`FeedPlayerPool`)
- Gesture controller (`useFeedGesture`)
- Buffer manager (`useFeedBuffer`)
- HLS adapter (`useHlsPlayer`)
- Network monitor (`useNetworkQuality`)
- Pull-to-refresh primitive
- End-of-feed card
- Web Share button
- Keyboard shortcuts handler
- Spring animation primitives (via framer-motion)

---

## 3. Architecture cible — diagramme et responsabilités

```
                       /scroll route (server component)
                                    │
                                    ▼  items[], chipFilters, rosterChips
                          <ScrollFeedV2 />  (client orchestrator)
                       /         │         \
                      /          │          \
                     ▼           ▼           ▼
        <ScrollChipBar/>   <FeedViewport/>   <PullToRefresh/>
                               │
                  ┌────────────┼────────────┐
                  ▼            ▼            ▼
        <FeedPlayerPool/> <FeedOverlays/>  <FeedGesture/>
                  │
                  ├── 5 <video> elements teleported via portal
                  │   to whichever item is currently in viewport
                  │
                  ├── HLS adapters attached on-demand
                  │
                  └── Buffer manager (preload N+5 / unload N-5)


   Items array (200-10000 clips depending on feed)
            │
            └── Each item = pure data, NO video element of its own
                Items render only the overlay/sidebar/badges UI
                Player overlays the item via absolute positioning + portal
```

### 3.1 Composants clés à créer

| Fichier | Rôle | Lignes estimées |
|---|---|---|
| `web/src/components/scroll/v2/ScrollFeedV2.tsx` | Orchestrator (remplace ScrollFeed.tsx) | 250 |
| `web/src/components/scroll/v2/FeedViewport.tsx` | Container snap-y custom (remplace CSS scroll-snap) | 150 |
| `web/src/components/scroll/v2/FeedPlayerPool.tsx` | Pool de 5 video elements + portal targets | 200 |
| `web/src/components/scroll/v2/FeedItem.tsx` | UI de chaque clip (overlays, sidebar, badges) sans video | 200 |
| `web/src/components/scroll/v2/EndOfFeedCard.tsx` | Card finale "tu as tout vu" + CTA vers /best | 80 |
| `web/src/components/scroll/v2/PullToRefreshIndicator.tsx` | Le rubber-band en haut | 80 |
| `web/src/components/scroll/v2/hooks/useFeedPlayer.ts` | Coordonne pool ↔ visible item | 150 |
| `web/src/components/scroll/v2/hooks/useFeedGesture.ts` | Drag + vélocité + spring snap | 200 |
| `web/src/components/scroll/v2/hooks/useFeedBuffer.ts` | Preload/unload window logic | 120 |
| `web/src/components/scroll/v2/hooks/useHlsPlayer.ts` | Attache hls.js selon device | 100 |
| `web/src/components/scroll/v2/hooks/useNetworkQuality.ts` | Monitor connection.effectiveType + downlink | 60 |
| `web/src/components/scroll/v2/hooks/useKeyboardShortcuts.ts` | J/K/M/L/C/Espace/↑↓ | 80 |
| `web/src/lib/scroll/spring.ts` | Spring physics constants partagés | 30 |

**Total ~1700 lignes nouvelles** (remplace ~1500 lignes du scroll v1).

### 3.2 Worker side : nouveau pipeline HLS

| Fichier | Rôle |
|---|---|
| `worker/modules/hls_packager.py` | Réencode chaque clip en HLS multi-bitrate (240p/480p/720p) |
| `worker/services/hls_uploader.py` | Upload du manifest .m3u8 + segments .ts à R2 |
| `supabase/migrations/007_hls_columns.sql` | Ajoute `hls_manifest_url`, `hls_master_url` à `kills` et `moments` |

---

## 4. Phases d'exécution (séquence + dépendances)

> Chaque phase produit un état shippable. On évite le big bang : la nouvelle route `/scroll-v2` cohabite avec `/scroll` jusqu'au switch final.

### Phase 0 — Setup + dépendances (0.5 jour)

- [ ] Décisions D1-D6 validées avec toi
- [ ] `pnpm add hls.js framer-motion @use-gesture/react`
- [ ] Crée `web/src/components/scroll/v2/` arborescence vide
- [ ] Crée `/scroll-v2` route qui pour l'instant renvoie le ScrollFeed v1 inchangé
- [ ] Migration 007 (ajouter colonnes HLS, NULL OK pour backward-compat)
- [ ] Branch dédiée `feat/scroll-tiktok-native` pour pouvoir merger Phase par Phase

### Phase 1 — Player pool + portal (1.5 jours) ⭐ critique

C'est le cœur. Si cette phase tient, le reste suit.

- [ ] `FeedPlayerPool.tsx` : 5 video elements créés au mount, jamais détruits, ré-attachables via React portal
- [ ] `useFeedPlayer.ts` : reçoit l'index visible courant, alloue les 5 videos comme suit :
  - Slot 0 → item actif
  - Slot 1 → item actif + 1 (préchargé, prêt à play instant)
  - Slot 2 → item actif + 2 (metadata seulement)
  - Slot 3 → item actif - 1 (utile pour swipe-back fluide)
  - Slot 4 → buffer libre (pour swap optimisé pendant scroll rapide)
- [ ] `FeedItem.tsx` : ne contient plus de `<video>`, juste un `<div data-feed-slot="X">` que le pool cible via portal
- [ ] Critère : scroller manuellement (sans gesture controller, juste avec scroll-snap CSS pour l'instant) à travers 200 clips ne dépasse pas 80 MB de mémoire onglet (mesuré via Chrome DevTools)

**Risque** : React portal performance avec 5 video elements re-targetés ~1x/seconde pendant le scroll. Mitigation : utiliser `createPortal` avec `useMemo` strict + `useSyncExternalStore` pour le slot mapping.

### Phase 2 — Gesture controller + spring snap (2 jours)

- [ ] `useFeedGesture.ts` : `@use-gesture/react` `useDrag` capture le `dy` + `vy` (vélocité)
- [ ] Pendant le drag : `<FeedViewport>` translate de `translateY(<dy>px)` en realtime via framer-motion `motion.div`
- [ ] Au release :
  - Si `|dy| > THRESHOLD_PX` (~viewport/4) OU `|vy| > THRESHOLD_VEL` → snap au clip suivant/précédent
  - Si `|vy| > FAST_FLICK_VEL` → snap +2 ou -2 clips (skip rapide)
  - Sinon → snap retour au clip courant
- [ ] Spring config : `framer-motion` `{ type: "spring", stiffness: 300, damping: 30, mass: 0.8 }` — valeurs à itérer sur device réel
- [ ] Désactiver le scroll-snap CSS pendant le drag pour pas avoir de fight avec le browser
- [ ] Mouse wheel desktop : intégrer dans le même controller (mappé sur dy * 0.5)
- [ ] Critère : sur iPhone 13 Safari, swipe up doit feel "indistinguishable from TikTok" (test subjectif user-validated)

**Risque** : iOS Safari a des bugs récurrents avec touch-action + framer-motion. Mitigation : `touch-action: pan-y` sur le viewport + tester sur device dès la première implémentation, pas en émulateur.

### Phase 3 — Buffer manager + network adaptation (1 jour)

- [ ] `useFeedBuffer.ts` : observe l'index visible, déclenche les `<video>.load()` sur les items du buffer window (active ± 5)
- [ ] `useNetworkQuality.ts` : `navigator.connection.effectiveType` + `downlink`, met à jour un context global toutes les 5s
- [ ] Le pool consomme la quality context pour décider quel `src` attacher (low/med/high)
- [ ] Critère : sur throttled "Fast 3G" Chrome DevTools, scroll de 10 clips d'affilée ne fait jamais apparaître le poster figé > 200ms

### Phase 4 — HLS pipeline (worker + frontend, 2.5 jours en parallèle)

**Worker side** (1.5 jour) :
- [ ] `hls_packager.py` : ffmpeg HLS multi-bitrate
  ```bash
  ffmpeg -i {clip}.mp4 \
    -map 0:v -map 0:v -map 0:v -map 0:a:0 \
    -c:v h264 -c:a aac \
    -filter:v:0 scale=-2:240 -b:v:0 400k -maxrate:v:0 600k \
    -filter:v:1 scale=-2:480 -b:v:1 1000k -maxrate:v:1 1500k \
    -filter:v:2 scale=-2:720 -b:v:2 2500k -maxrate:v:2 3500k \
    -hls_time 2 -hls_playlist_type vod \
    -master_pl_name master.m3u8 \
    -var_stream_map "v:0,a:0 v:1,a:0 v:2,a:0" \
    {clip_id}_%v.m3u8
  ```
- [ ] `hls_uploader.py` : upload manifest + segments à R2 sous `hls/{clip_id}/`
- [ ] Backfill batch : re-encode les 340 clips existants en HLS (1 fois)
- [ ] Le pipeline normal (clipper → analyzer → og_generator) reste inchangé, on ajoute juste un module `hls_packager` qui tourne après `clipper`

**Frontend side** (1 jour) :
- [ ] `useHlsPlayer.ts` : `if (Hls.isSupported() && !navigator.userAgent.includes('Safari'))` → attache hls.js, sinon fallback `<video src={hls_master_url}>` (Safari lit HLS natif)
- [ ] Pool consomme `useHlsPlayer` au lieu de `videoElement.src = mp4`
- [ ] Fallback : si `hls_master_url === null` (clip pas encore re-encodé), retomber sur `clip_url_vertical` MP4
- [ ] Critère : un clip au switch de bitrate (passage 4G → wifi pendant playback) ne doit pas avoir de saut visible

**Risque** : R2 storage va exploser. Estimation : 340 clips × (240p + 480p + 720p) HLS ≈ 5 GB additionnel. Sur free tier 10 GB on est encore OK, mais avec le pivot Kameto (3000+ clips) on dépassera. Décision à valider : est-ce qu'on encode les anciens clips ou seulement les nouveaux ?

### Phase 5 — End-of-feed + Pull-to-refresh + Web Share (1 jour)

- [ ] `EndOfFeedCard.tsx` : carte spéciale insérée APRÈS le dernier item du feed avec :
  - "Tu as vu tous les clips de ce feed"
  - 3 CTA : "Re-mélanger", "Voir les meilleurs", "Voir les multi-kills"
- [ ] `PullToRefreshIndicator.tsx` :
  - Détecte le drag-down quand on est déjà au top
  - Rubber-band animation
  - Au release, déclenche un re-shuffle local (pas un fetch DB) avec un nouveau random seed
- [ ] Web Share button :
  ```ts
  if (navigator.share) {
    await navigator.share({
      title: `${killer} → ${victim}`,
      text: aiDescription,
      url: `https://kckills.com/kill/${id}`,
    });
  } else {
    // fallback: copy to clipboard + toast
    await navigator.clipboard.writeText(...);
  }
  ```

### Phase 6 — Keyboard shortcuts + desktop polish (0.5 jour)

- [ ] `useKeyboardShortcuts.ts` :
  - `↑` / `J` → previous clip (snap)
  - `↓` / `K` → next clip
  - `Espace` → toggle play/pause
  - `M` → toggle mute
  - `L` → like (rate 5)
  - `C` → open comments
  - `?` → show shortcuts overlay
- [ ] Hover-pause sur desktop (déjà dans v1 ?)
- [ ] Side-by-side layout quand viewport > 1600px (carte clip + comments rail toujours visible)

### Phase 7 — Migration switch + cleanup (0.5 jour)

- [ ] A/B comparison : ouvrir `/scroll` et `/scroll-v2` côte-à-côte sur device, valider feel + perf
- [ ] Lighthouse audit comparatif `/scroll` vs `/scroll-v2`
- [ ] Si v2 dépasse v1 sur tous les axes → swap : `/scroll` redirige vers `/scroll-v2` puis on rename
- [ ] Supprimer les anciens fichiers v1 après une semaine sans regression
- [ ] Update docs internes + CLAUDE.md

### Phase 8 — Stress test mass scale (parallel avec phases 1-7)

- [ ] Script de seed Supabase : insère 5000 fake clips pour stress tester le pool + buffer
- [ ] Test sur device réel : iPhone 13 mini, Samsung A52, MacBook Air M1
- [ ] Mesures : memory, CPU, GPU, battery drain, time to first frame, dropped frames

---

## 5. Total effort estimé

| Phase | Jours homme |
|---|---|
| 0 — Setup | 0.5 |
| 1 — Player pool ⭐ | 1.5 |
| 2 — Gesture | 2 |
| 3 — Buffer + network | 1 |
| 4 — HLS (worker + front en parallèle) | 2.5 |
| 5 — End-of-feed + PTR + Share | 1 |
| 6 — Keyboard + desktop | 0.5 |
| 7 — Migration + cleanup | 0.5 |
| 8 — Stress test (parallèle) | inclus |
| **TOTAL séquentiel** | **9.5 jours** |

À deux personnes (worker + frontend en parallèle Phase 4) : ~7.5 jours.

---

## 6. Risques & mitigations

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Portal targeting des `<video>` lent en React 19 | M | H | Bench dès Phase 1 ; fallback : utiliser `useSyncExternalStore` + manipulation DOM directe via ref si React rendering est trop lent |
| Spring physics qui feel "wrong" (uncanny valley) | H | M | Tester valeurs sur device réel dès Phase 2 jour 1 ; itérer avec toi sur 2-3 réglages |
| iOS Safari blocages divers (touch-action, autoplay) | H | H | Test device réel à chaque phase, jamais juste émulateur Chrome |
| HLS R2 storage explosion | M | M | Décision à prendre : encoder seulement les nouveaux clips post-pivot ou tout le backlog ? |
| Bundle dépasse 200 KB First Load | M | M | Audit Webpack à chaque phase, code-split agressif (hls.js dynamique sur Android only) |
| Compatibilité Discord embed in-app browser (Discord lance les links dans son webview custom) | M | H | Test depuis Discord mobile dès Phase 5 |
| Pull-to-refresh conflict avec le browser native PTR (Chrome Android) | H | L | `overscroll-behavior: contain` sur le viewport |
| Pool de 5 videos = 5 connexions R2 simultanées au load → throttle | L | M | Stagger les `.load()` calls via setTimeout |

---

## 7. Compatibilité avec le pivot Kameto VOD-only

Le scroll TikTok-native est un **prérequis** du pivot Kameto, pas un blocker. Voilà pourquoi :

- Kameto pivot = catalogue × 10 (de 340 → 3000+ clips), donc **virtualization obligatoire** (Phase 1)
- Kameto = sources hétérogènes (différents streamers / langues), donc **filter chips encore plus critiques** (déjà fait, on garde)
- Kameto = besoin de découverte (tu vas pas tout regarder), donc **end-of-feed recommendation** (Phase 5) prend tout son sens
- Kameto = audience internationale, donc **HLS adaptive** (Phase 4) devient critique pour réseau hétérogène

**Décision** : on fait le scroll TikTok-native en premier, puis on lance Kameto sur des fondations qui peuvent encaisser le scale.

---

## 8. Quick wins shippables IMMÉDIATEMENT (avant Phase 1)

3 fixes < 1h chacun qui améliorent le scroll v1 actuel sans bloquer le chantier v2 :

- [ ] **Web Share API sur le bouton share existant** (30 min) — gros gain UX mobile, zéro risque
- [ ] **Stagger `<video>.load()` au mount** : évite les 340 video elements qui se chargent tous en même temps si le user fait Cmd+F → preview tous (15 min)
- [ ] **`overscroll-behavior: contain`** sur le scroll container (5 min) — évite le browser PTR natif qui interfère

Tu veux que je shippe ces 3 quick wins **maintenant**, en attendant ta validation des décisions D1-D6 et le go pour Phase 0 ?

---

## 9. Prochaine étape

À ta décision :

1. **Tu valides les décisions D1-D6** (ou tu en challenges certaines, on en discute)
2. **Tu décides du timing** : on attaque Phase 0 quand ?
3. **Tu décides du scope HLS** : on encode tous les anciens clips ou seulement les nouveaux post-Kameto ?

Une fois ces 3 points figés, je peux commencer Phase 0 dans la foulée.
