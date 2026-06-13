---
name: esports-data-retrieval
description: >
  Protocole permanent de récupération de données esport LoL publiques pour
  KCKILLS (stats joueurs/champions/matchs Karmine Corp : winrate, KDA, games,
  rosters, calendrier, VODs…). À DÉCLENCHER dès que je crois manquer une donnée
  qui existe sur une source publique — winrate d'un joueur sur un champion,
  KDA, nombre de games, historique, roster, résultat de match, etc. RÈGLE
  ABSOLUE : ne jamais dire « je ne peux pas avoir cette donnée » ni demander à
  Mehdi de l'ajouter à la main ; toujours tenter de la récupérer via ce
  protocole d'abord. Déclencheurs typiques : « la base n'a pas X », « game_
  participants est vide », « je n'ai pas le winrate de … », « il faudrait les
  stats de … », « ajoute la donnée », « c'est public, va la chercher ».
---

# Protocole de récupération de données esport (KCKILLS)

## 0. Règle d'or

Avant d'écrire « je n'ai pas cette donnée », « la base ne la contient pas » ou
« peux-tu me donner X ? » pour une donnée **publique** (stats LoL esport) :
**STOP — tente d'abord ce protocole.** Mehdi n'a pas à fournir une donnée que
gol.gg, Leaguepedia ou dpm.lol affichent gratuitement. Si après avoir épuisé
les sources la donnée reste introuvable, alors seulement le signaler — en
listant ce qui a été essayé.

Et : **ne jamais inventer un chiffre.** Donnée non trouvée ⇒ on le dit ; on ne
met pas un placeholder qui ressemble à une vraie stat (j'ai déjà fait l'erreur
avec un winrate Vi « 88% » inventé — le vrai était 90.9%, trouvé en 4 clics).

## 1. Hiérarchie des sources (structuré d'abord, scrape ensuite)

### A. APIs / sources structurées — à préférer (rapide, exact, scriptable)

| Source | Pour quoi | Accès |
|---|---|---|
| **lolesports API** | calendrier, matchs, équipes, live, VODs+offsets | `esports-api.lolesports.com` (clé dans le worker, cf. CLAUDE.md §3.1) ; `feed.lolesports.com` pour les frames live |
| **Leaguepedia Cargo API** | stats joueur/champion/tournoi, rosters, picks/bans | `https://lol.fandom.com/api.php?action=cargoquery&format=json&tables=…&fields=…&where=…` — tables clés : `ScoreboardPlayers` (Link, Champion, Kills/Deaths/Assists, Team), `ScoreboardGames` (Winner, WinTeam, DateTime_UTC), `Players`, `TournamentPlayers`, `PicksAndBansS7`. Joindre ScoreboardPlayers↔ScoreboardGames sur GameId pour le W/L. |
| **Oracle's Elixir** | dataset complet matchs pro (CSV) | téléchargement CSV `oracleselixir.com` — lourd, pour de l'analyse en masse |
| **Riot Data Dragon** | assets champions (icônes, splash, loading) | `ddragon.leagueoflegends.com/cdn/img/champion/{splash,loading}/<Champ>_<skin>.jpg` — déjà câblé via `championSplashUrl()` / `championIconUrl()` (autorisé CSP + remotePatterns) |

### B. Scrape via **Chrome MCP + Vision** — fallback pour les sites sans API

| Source | Pour quoi | Comment |
|---|---|---|
| **gol.gg** (Games of Legends) | LA référence stats **pro** par joueur × champion (games / win rate / KDA) | page joueur → onglet **STATISTICS** → table CHAMPION. URL directe : `gol.gg/players/player-stats/<ID>/season-{ALL\|S16}/split-{ALL\|Spring\|Winter}/tournament-ALL/champion-ALL/`. Recherche du joueur via la barre « Search… » en haut à droite. **Yike = id 3406.** |
| **dpm.lol / RFT.GG** | stats SoloQ + hub esport (RFT.GG est fait par dpm.lol) | barre de recherche (Ctrl+K). ⚠️ les profils « summoner » = **SoloQ**, pas l'officiel — pour l'officiel passer par leur section Esports ou préférer gol.gg |
| **Leaguepedia (pages wiki)** | roster, historique, contexte | `lol.fandom.com/wiki/<Joueur|Équipe>` |

## 2. Méthode Chrome + Vision (pas à pas)

1. `tabs_context_mcp{createIfEmpty:true}` pour obtenir un tabId, puis `navigate`.
2. **Bandeaux de consentement RGPD** : TOUJOURS refuser le non-essentiel
   (« Do not consent » / « Reject all » / MORE OPTIONS → Reject). Ne JAMAIS
   cliquer « Accept/Agree/Consent » (règle vie privée + accepter un bandeau
   demande l'accord explicite de l'utilisateur). gol.gg → « Do not consent ».
   dpm.lol → MORE OPTIONS → REJECT ALL → SAVE & EXIT.
3. Chercher l'entité (joueur/champion/équipe) via la barre de recherche du site.
4. **Lire** : `read_page` (texte/valeurs exacts, fiable pour les nombres) +
   `screenshot` (Vision) pour confirmer visuellement la bonne ligne/colonne.
   Batcher les actions prévisibles avec `browser_batch`.
5. **Toujours noter la SOURCE + la DATE + le périmètre** (ex. « gol.gg id 3406,
   2026-06-13, split S16 Spring »). Le périmètre compte : carrière vs split,
   SoloQ vs officiel.

## 3. Catalogue — données KC fréquentes → où les prendre

- **Winrate / KDA / games d'un joueur sur un champion** → gol.gg (table CHAMPION
  de la page joueur). Carrière = `season-ALL/split-ALL`, saison en cours =
  `season-S16/split-Spring`.
- **Roster / changements / coach** → Leaguepedia.
- **Calendrier / résultats / VODs** → lolesports API (worker) ou Leaguepedia.
- **Splash / icône d'un champion** → Data Dragon (`championSplashUrl`).
- **Stats agrégées équipe** → gol.gg (page équipe) / Oracle's Elixir.

## 4. Intégration dans le code

- **Donnée ponctuelle** (un stat affiché) → constante **sourcée + datée**, avec
  un commentaire indiquant la source et comment la rafraîchir. Modèle : le bloc
  `VI_STATS` dans `web/src/components/home/ViShowcase.tsx` (source gol.gg id 3406,
  date, périmètre split).
- **Donnée récurrente / qui doit vivre** → idéalement remplir le pipeline worker
  (ex. `game_participants` est **vide** en base : le worker ne l'alimente pas →
  c'est la cause racine de l'absence de winrates côté DB ; à terme, brancher le
  HARVESTER / une réconciliation post-game sur lolesports API + Leaguepedia
  Cargo pour le peupler). En attendant : constante rafraîchie via ce protocole.
- **Toujours** : commentaire `source + date + comment refresh` au-dessus de la
  constante.

## 5. Faits connus de ce projet (à réutiliser)

- **Yike → gol.gg player id `3406`.** Vi : carrière 52 games / 63.5% WR ;
  S16 Spring 11 games / **90.9% WR** / 6.3 KDA (au 2026-06-13).
- `game_participants` **vide** en base → toute stat joueur×champion passe par ce
  protocole tant que le worker ne le remplit pas.
- Assets champions servis via Data Dragon (CSP + `next.config` les autorisent).

## 6. Anti-patterns (à ne jamais faire)

- ❌ « Je ne peux pas récupérer cette donnée » sans avoir tenté A puis B.
- ❌ Demander à Mehdi une donnée publique (« donne-moi le winrate »).
- ❌ Inventer / estimer un chiffre et le présenter comme réel.
- ❌ Accepter un bandeau cookies pour aller plus vite.
- ❌ Confondre SoloQ et officiel, ou carrière et split, sans le préciser.
