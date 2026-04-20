# Handoff prompt — kckills.com

> À coller dans une nouvelle session AI (Claude Sonnet/Opus, GPT-5, Gemini, peu importe). Tout ce qu'il faut savoir pour reprendre sans backstory.

---

## Qui je suis

Je m'appelle Mehdi (alias Numelite). Je dev solo **kckills.com** (alias LoLTok pilote) — site communautaire de clips de kills League of Legends centré sur la **Karmine Corp** (équipe esport française en LEC). Le pilote sert de showcase technique pour une plateforme plus large multi-streamer / multi-langue (LOLTOK).

C'est moi qui décide les priorités. Pas d'investisseur, pas de deadline officielle, pas d'équipe. Le streamer **EtoStark** (joueur KC) montrera le site en live à un moment donné mais on n'a pas la date — donc on vise **working grade solide**, pas "MVP qui marche en démo".

## Stack et structure

```
C:\Users\Matter1\Karmine_Stats\          ← PARENT REPO (main branch)
│
├── web/                                  Next.js 15 App Router + RSC
│   ├── src/app/                          Routes
│   ├── src/components/                   UI components (incl. scroll/v2/)
│   ├── src/lib/supabase/                 Data layer (server-only)
│   └── package.json                      npm (lockfile = package-lock.json)
│
├── worker/                               Python 3.14 daemon
│   ├── main.py                           Supervised asyncio orchestrator
│   ├── modules/                          sentinel, harvester, clipper, analyzer, og_generator, watchdog
│   ├── scripts/                          One-shot maintenance scripts (regen, backfill, etc.)
│   ├── services/                         supabase_client, gemini_client, etc.
│   └── .venv/                            Python venv (Windows: .venv\Scripts\python.exe)
│
├── supabase/migrations/                  001 → 008 SQL migrations (apply manually in Supabase Studio)
│
└── .claude/worktrees/cranky-elion-cebf12/  ← WORKTREE (branch claude/cranky-elion-cebf12)
                                             Tu codes ici, tu commits ici.
```

**Branch / push convention** :
- Worktree branche = `claude/cranky-elion-cebf12`, mirrors `main`
- Toujours pusher les 2 :
  ```
  git push origin claude/cranky-elion-cebf12
  git push origin HEAD:main
  ```
- Vercel auto-deploy depuis `main`

**⚠️ Piège git worktree** : la dossier `worker/` du worktree est **désynchro** de `worker/` du parent repo. Le worker daemon tourne sur le parent (`C:\Users\Matter1\Karmine_Stats\worker`). Quand tu modifies un fichier worker, tu dois :
1. Éditer dans `C:\Users\Matter1\Karmine_Stats\worker\...` (où le daemon le lit)
2. **Copier le fichier vers le worktree** avant `git add` :
   ```
   cp parent/worker/<file> worktree/worker/<file>
   ```
3. Commit depuis le worktree

## Stack technique

| Composant | Tech | Notes |
|---|---|---|
| Frontend | Next.js 15 + React 19 + Tailwind v4 | App Router, RSC partout |
| State client | framer-motion + @use-gesture/react | Pour `/scroll-v2` |
| HLS player | hls.js (lazy Android) + native (Safari) | Phase 4 |
| DB | Supabase Postgres + RLS | Free tier, 5GB egress/mois |
| Storage | Cloudflare R2 | Free 10GB, zéro egress |
| Worker IA | Gemini 2.5 Flash-Lite | 1000 RPD, scheduler global |
| Modération | Claude Haiku 4.5 | $1/M input |
| Auth | Supabase + Discord OAuth | (existe, non testé end-to-end) |
| Deploy | Vercel hobby | Push main → auto-deploy |

## État du projet (19 avril 2026)

### Ce qui marche en prod

- **`/scroll`** v1 — feed TikTok-shaped, MP4 progressif, scroll-snap CSS, autoplay pool 1-per-item, 340 kills. Stable.
- **`/scroll-v2`** — TikTok-native (player pool 5, gesture+spring, buffer, HLS adapter, PTR, end-of-feed, chips, keyboard). Banner gold "Phase 6 — full feature parity" en haut. **À valider par Mehdi avant Phase 7 swap**.
- **Toutes les autres pages** : `/`, `/best`, `/recent`, `/multikills`, `/first-bloods`, `/champions`, `/champion/[name]`, `/matchups`, `/matchup/[a]/vs/[b]`, `/players`, `/player/[slug]`, `/matches`, `/match/[slug]`, `/stats`, `/sphere` (3D experimental), `/alumni`, `/era/[id]`, `/hall-of-fame`, `/records`, `/api-docs`, etc. — toutes en prod, build green à 165+ pages.
- **JSON-LD** (VideoObject, Person, SportsEvent, CollectionPage) sur toutes les pages détail.
- **Cmd-K palette** avec full-text clip search via `/api/palette/clips`.
- **`/api/live`** proxy LolEsports cached 60s + 30s SWR (LiveBanner).

### Données

- **340 kills publiés** en Supabase, tous avec : 3 formats vidéo MP4 (h/v/v_low), thumbnail, OG image, ai_description (Gemini), ai_tags, fight_type ground truth, multi_kill, is_first_blood, kill_visible, etc.
- **Migrations 001-008 appliquées en prod** (Mehdi confirmed 18 avril 2026)
- **Worker daemon** tourne (ou tournait — à vérifier au démarrage de la session avec `tasklist | grep python`)

### Audit Opus 4.7 sur les 340 descriptions IA

Mehdi a fait passer un rapport Opus 4.7. Verdict : **6.5/10 base, 45 descriptions à régénérer**. Tout l'audit a été implémenté côté code (commit `962292f`) :
- `worker/modules/analyzer.py` prompt v4 avec ground truth + anti-hallucination + variété
- Post-validation (rejet + retry 3x → manual_review)
- `kill_visible=true` forcé partout sauf `/kill/[id]` deep-link
- Frontend banlist `isDescriptionClean()` dans 5 composants
- Script `worker/scripts/regen_audit_targets.py` prêt

**⚠️ Le regen N'A PAS encore été lancé.** Mehdi doit exécuter manuellement :
```powershell
cd C:\Users\Matter1\Karmine_Stats\worker
.venv\Scripts\python.exe -m scripts.regen_audit_targets --dry-run
.venv\Scripts\python.exe -m scripts.regen_audit_targets
# tape "yes"
```

Le daemon analyzer pickup au prochain cycle (~10min) et regénère les 45 avec prompt v4.

## Travail en cours / pending

| Priorité | Item | Statut | Bloquant |
|---|---|---|---|
| 🟡 | Mehdi valide UX `/scroll-v2` sur iPhone | À faire | — |
| 🟡 | Mehdi lance regen 45 descriptions | À faire | — |
| 🟢 | Phase 7 — rename `/scroll-v2` → `/scroll`, supprimer v1 | Bloqué | Validation Mehdi |
| 🟢 | Worker `hls_packager.py` — ffmpeg multi-bitrate + upload R2 | Pas commencé | — |
| 🔴 | **Pivot Kameto VOD-only** | Pas commencé | Re-archi sourcing complète |

### Pivot Kameto (le gros chantier que Mehdi a teasé)

Quand on s'y mettra : abandonner les VODs LEC officiels (qui donnent `vod.offset` direct via API lolesports) au profit de la **chaîne YouTube Kameto** uniquement, pour pouvoir backfill toutes les games KC depuis sa création (2021). Implications :
- Pas d'`vod.offset` officiel → faut détecter par OCR le timer in-game à frame 0 du VOD
- Plusieurs games par VOD Kameto (rebroadcasts) → besoin d'un VOD splitter
- Match-up reconciliation avec Oracle's Elixir / Leaguepedia
- ~1200 games à processer pour le full backfill

Doc complet : `PLAN_TIKTOK_NATIVE.md` à la racine du repo (les décisions D1-D6 sont verrouillées).

## Conventions à respecter

1. **Pas de flatterie**. Mehdi déteste le commercial. Sois direct, dis ce qui marche, dis ce qui foire.
2. **Honnêteté > démo**. Si tu ne sais pas, vérifie. Si t'as cassé un truc, dis-le tout de suite.
3. **Banlist défense-in-depth** : toute rendering de `ai_description` doit passer par `isDescriptionClean()` de `lib/scroll/sanitize-description.ts`. Worker valide aussi avant write.
4. **kill_visible=true filter** : appliqué automatiquement par la RPC `fn_get_clips_filtered` (migration 008) et par `getPublishedKills`. Seul `getKillById` reste sans filtre (deep-link).
5. **JSX text** : ne JAMAIS écrire `\u00e9` directement dans du JSX text — JSX n'interprète pas les escapes. Utilise le caractère literal (é) ou wrap dans `{...}`.
6. **Build avant commit** : `cd web && npx tsc --noEmit && npx next build`. Si build vert et < 200kB First Load sur `/scroll-v2`, OK.
7. **Disk** : on était à 99% plein le 18 avril. `du -sh worker/clips` pour check, on peut purger les MP4 locaux (déjà sur R2).

## Ce qui peut nécessiter une intervention immédiate

- **Worker daemon** : si `tasklist | grep python` ne retourne rien, le relancer :
  ```
  cd C:\Users\Matter1\Karmine_Stats\worker
  .venv\Scripts\python.exe main.py
  ```
- **Si `/scroll` est vide** : check les migrations Supabase appliquées. Erreurs SELECT silencieuses dans `lib/supabase/kills.ts` retournent `[]` → splash mode visible. Le bug le plus récent était une colonne dans le SELECT pas encore migrée. Migrations 007 + 008 normalement appliquées.
- **Quota Gemini** : 1000 RPD, reset 07:00 UTC. Si épuisé, le regen 45 descriptions doit attendre demain.

## Comment me parler

Je préfère :
- Réponses courtes, structurées, en français
- Diagnostics avant solutions
- Du markdown avec code blocks, tableaux, emojis (sobres : 🔴 🟡 🟢 ⚠️ ✅)
- Quand t'as fini une grosse tâche, récap par commit avec hash + 1 ligne par commit
- Si tu shippes plusieurs commits dans une session, push branch + main à la fin
- "À toi" / "standing by" quand tu as fini et attends ma direction

J'ai pas peur des refactos massifs si c'est justifié. J'ai pas peur de roll-back si quelque chose foire. Mode **autonomous-but-honest** — tu décides, tu m'expliques pourquoi, je peux te corriger.

## Pour démarrer ta session

1. `cd C:\Users\Matter1\Karmine_Stats\.claude\worktrees\cranky-elion-cebf12 && git log --oneline -10` — pour voir l'historique récent
2. `git status` + `git fetch origin && git log origin/main..HEAD --oneline` — pour vérifier qu'on est sync
3. `tasklist 2>&1 | grep python` (ou équivalent) — vérifier si le worker daemon tourne
4. Demande à Mehdi ce qu'il veut faire — pas de proactivité aveugle. Mais propose 2-3 options actionnables si tu vois un truc qui traîne (ex: regen pas lancé, Phase 7 pas swappée).

Bon courage. 🎯
