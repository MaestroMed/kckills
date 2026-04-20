# Prompt — Audit qualité des descriptions IA (Gemini 2.5 Flash-Lite)

> À coller dans Opus 4.7 avec le fichier `clip_descriptions_audit.md` en attachement.

---

## Contexte projet

Tu auditeras la qualité de **340 descriptions FR** générées par Gemini 2.5 Flash-Lite pour le site **kckills.com** (alias KCKILLS) — une plateforme de clips esport League of Legends centrée sur la **Karmine Corp** (KC), équipe française qui joue en LEC. Chaque clip dure ~14-22 secondes et représente un kill ou une mort impliquant un joueur KC dans un match pro 2025-2026.

Les descriptions sont visibles publiquement :
- Sur le feed `/scroll` (style TikTok plein écran), juste sous le matchup
- Sur la page détail `/kill/[id]`
- Comme fallback sur les cartes de clips dans tout le reste du site

Audience cible : **fanbase KC** — gamers FR, registre familier mais pas vulgaire, à l'aise avec le jargon LoL (gank, pick, teamfight, ulti, R, Q, Z, peel, engage, etc.). Ton attendu : **commentateur esport hypé** (style Drakos, Trobi, Doigby) — punchy, factuel, jamais creux.

## Pipeline qui a généré ces descriptions

```
Vidéo MP4 (clip déjà coupé, 14-22s, 720p vertical)
    ↓
Gemini 2.5 Flash-Lite avec prompt v3 + INPUT lines de ground truth :
  - fight_type_truth (calculé server-side : solo_kill / skirmish_2v2 / teamfight_4v4 etc.)
  - matchup_lane_truth (top / mid / jungle / bot / support / cross_map)
  - lane_phase_truth (early / mid / late)
  - multi_kill_truth (None / double / triple / quadra / penta)
    ↓
JSON output : { highlight_score, tags[], description_fr, kill_visible, caster_hype_level }
    ↓
Write à kills.ai_description, ai_tags, highlight_score
```

Le prompt v3 contient :
- 8 exemples de bonnes descriptions
- Liste de phrases BANNIES ("met le feu", "fait des merveilles", etc.)
- Règle stricte : **INTERDIT** d'écrire "1v1" ou "solo kill" si `fight_type_truth ≠ solo_kill`
- Cap 120 chars / max 5 tags

## Données contextuelles à connaître pour l'audit

**Roster KC LEC 2026** :
- Canna (TOP), Yike (JGL), Kyeahoo (MID), Caliste (ADC), Busio (SUP)

**Champions cités fréquemment côté KC** :
- Caliste joue souvent : Jhin, Varus, Caitlyn, Ashe, Corki
- Canna : KSante, Renekton, Jax, Gnar, Ambessa
- Yike : Nocturne, Vi, Skarner, MonkeyKing, Naafiri
- Kyeahoo : Ahri, Anivia, Orianna
- Busio : Rell, Nautilus, Rakan

**Adversaires nommés** : "Nako" / "Naak Nako" = mid-laner GiantX.

## Ta mission

Lis le fichier `clip_descriptions_audit.md` en entier (340 descriptions sous forme de tableau Markdown). Évalue la qualité globale ET détecte les patterns problématiques. Produis un rapport structuré comme spécifié plus bas.

### Critères d'évaluation

Pour chaque description, juge sur 5 axes :

1. **Cohérence avec le matchup** — le killer/victim mentionnés correspondent-ils à ceux du tableau ? Est-ce que la description invente un champion qui n'est pas là ?
2. **Cohérence avec le fight_type** — si `fight_type=teamfight_5v5`, la description doit refléter le contexte teamfight, pas un duel. Si `solo_kill`, l'inverse.
3. **Cohérence avec multi-kill / FB** — si `multi=triple`, la description devrait soit mentionner le multi-kill soit au moins refléter une séquence d'actions.
4. **Qualité narrative** — punchy, factuelle, registre commentateur ; pas creux, pas générique, pas de phrases bannies recyclées.
5. **Justesse mécanique** — les sorts cités (R, Q, Z, ulti) sont plausibles pour le champion ? Pas d'invention manifeste ?

### Patterns problématiques à chasser activement

- **Descriptions clones** — N descriptions quasi-identiques pour des matchups différents (Gemini en mode lazy)
- **Mentions de champions absents du matchup** — hallucination
- **Contradiction fight_type** — "1v1" alors que c'est un teamfight (le bug d'origine qu'on a fixé en avril)
- **Crédits joueurs incorrects** — "Yike fait X" alors que le killer est censé être Caliste
- **Descriptions creuses** — "X élimine Y", "X tue Y avec son ulti" sans aucun contexte tactique
- **Sur-utilisation de tournures** — "termine", "achève", "élimine", "neutralise" en boucle
- **Erreurs de genre/orthographe** — Gemini est moyen sur les accords français
- **Clips à kill_visible=false** (8 clips marqués ⚠️not-visible) — la description décrit-elle quand même quelque chose de cohérent ou divague-t-elle ?

## Format de rapport attendu

```markdown
## 1. Verdict global (1 paragraphe)

Note la base sur 10. Spot strengths / weaknesses. Réponds à : "est-ce
production-ready pour un launch streamer ou faut une nouvelle passe ?"

## 2. Top 10 best descriptions
Liste les 10 que tu trouves les meilleures (ID + brève raison).

## 3. Top 20 worst descriptions à régénérer
Liste les 20 plus problématiques avec :
  - ID
  - Catégorie d'erreur (clone | hallucination | fight_type_wrong | creux | autre)
  - Citation courte de ce qui cloche
  - Ce que la description DEVRAIT dire (si tu peux le déduire du contexte)

## 4. Patterns systémiques

Identifie 3-5 patterns récurrents (pas juste isolés). Pour chacun :
  - Description du pattern + nombre approximatif d'occurrences
  - Hypothèse sur la cause (prompt, modèle, contexte manquant)
  - Suggestion d'amélioration concrète du prompt v3

## 5. Vocabulaire répétitif

Liste les 10 mots/tournures les plus surutilisés. Suggère des
synonymes ou ajustements à ajouter au prompt.

## 6. Cas limites — kill_visible=false

Pour chacun des 8 clips marqués ⚠️not-visible (si présents dans la
section bas-de-tableau), juge si la description tient ou délire.

## 7. Verdict opérationnel

  - Les N descriptions à régénérer en priorité (par ID)
  - Le patch concret à apporter au prompt v3 (en français, prêt à
    coller dans worker/modules/analyzer.py)
  - Décision sur kill_visible=false en published : laisser ou exclure ?

## 8. Bonus — quick wins

3-5 fixes triviaux qu'on peut shipper en moins d'une heure pour
améliorer la qualité moyenne (ex: filter post-Gemini sur N caractères,
dédup descriptions identiques, etc.).
```

## Contraintes

- Soit **direct et chirurgical**. Pas de flatterie ("excellent travail !"). Si la base est moyenne, dis-le.
- Cite des **IDs précis** quand tu pointes un problème (les 8 premiers caractères suffisent — c'est le format dans le tableau).
- Le verdict opérationnel doit être **actionnable** : si tu suggères un patch prompt, fournis le texte exact.
- Penses **production** : 340 clips qui vont être vus par EtoStark en stream live + sa fanbase. Faux positifs sur "à régénérer" coûtent du quota Gemini, faux négatifs ruinent la crédibilité.
