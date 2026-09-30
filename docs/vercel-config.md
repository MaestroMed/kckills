# Vercel — quand le site est reconstruit

Fichier : `web/vercel.json` (Root Directory du projet Vercel = `web/`).

## Les deux règles

1. `git.deploymentEnabled.main: true` — seule `main` est activée.
2. `ignoreCommand` — exécuté par Vercel après le checkout, dans `web/` :

```sh
if [ "$VERCEL_GIT_COMMIT_REF" != "main" ]; then exit 0; fi   # branche ≠ main : pas de build
if [ -z "$VERCEL_GIT_PREVIOUS_SHA" ]; then exit 1; fi        # 1er déploiement : build
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" "$VERCEL_GIT_COMMIT_SHA" -- . && exit 0 || exit 1
```

Rappel Vercel : `exit 0` = on saute le build, `exit 1` = on construit.

## Pourquoi le filtre sur `web/` (30/09/2026)

Le worker Python, les scripts et `supabase/` vivent dans le même dépôt. Chaque
push sur `main` qui ne touchait que `worker/` reconstruisait le site pour rien
(minutes de build facturées). Désormais un push sur `main` ne construit que si
`web/` a changé depuis le **dernier déploiement réussi**.

- `VERCEL_GIT_PREVIOUS_SHA` = SHA du dernier déploiement réussi de la branche
  (exposé uniquement quand un Ignored Build Step est défini). Comparer à lui,
  et pas à `HEAD^`, évite de rater un changement web poussé dans le même lot
  qu'un commit worker.
- Tout cas douteux construit : premier déploiement, SHA absent du clone
  (`git diff` sort en 128), erreur git.
- Le build du site ne dépend d'aucun fichier hors de `web/` (vérifié le 30/09 :
  pas d'import relatif sortant, pas de `outputFileTracingRoot`).

## Forcer un déploiement

Pousser un commit qui touche un fichier sous `web/`.

Ne jamais ajouter de clé `_comment` dans `vercel.json` : le schéma Vercel la
refuse et le build échoue. Documenter ici.
