# HANDOFF → session admin backoffice
### De : Fable (session worker, PC Mehdi) — 2026-07-14
### Contexte : refonte décryptage/dédup livrée sur la branche `claude/worker-decryptage`. Mehdi a appliqué les migrations **088, 089 ET 090** dans le SQL editor. Ce doc liste ce qui te concerne.

---

## 🔴 URGENT — tes pages admin lisent du vide depuis la 090

La 090 a passé 7 vues de SECURITY DEFINER → `security_invoker` (flag
CRITICAL de l'Advisor Supabase : n'importe quel anon pouvait lire l'audit
trail admin, l'historique push, etc.). Conséquence : **ces vues renvoient
désormais 0 ligne via le client anon** (`createServerSupabase`). Les call
sites à basculer sur `createServiceSupabase()` (server-only, jamais
exposé au client) :

| Fichier | Vue(s) concernée(s) |
|---|---|
| `web/src/app/admin/analytics/page.tsx` (L126-127) | `v_clip_engagement_24h`, `v_trending_kills_1h` |
| `web/src/app/admin/audit/page.tsx` (L87) | `v_admin_actions_7d` |
| `web/src/app/admin/push/page.tsx` (L51) | `v_recent_push_notifications` |
| `web/src/app/admin/pipeline/page.tsx` (L72) | `v_pipeline_health` |
| consommateurs de `v_ai_cost_24h` (dashboard ?) | `v_ai_cost_24h` |

**Cas spécial** : `/api/players/[id]/follow` ne peut plus compter les fans
via `v_player_fans_count` en anon. La 090 fournit le remplaçant :
```ts
const { data } = await sb.rpc("fn_player_fans_count", { p_player_id: id });
```
(SECURITY DEFINER volontaire : n'expose QUE l'agrégat, jamais les rows.)

## 🟠 Nouveaux objets DB dont l'admin peut profiter

- **`kills.status` accepte `duplicate` et `needs_review`** ;
  `kills.is_duplicate_of` pointe le kill canonique. La 089 a neutralisé
  **3 025 doublons** (le feed est passé de 2 993 → 2 642 publiés — les
  351 doublons visibles ont disparu, c'est voulu). Ne JAMAIS delete un
  duplicate : ses kill_assets/R2 restent référencés.
- **`clip_ledger`** (088) : méga-table d'audit, une ligne par kill
  canonique — offset résolu multi-points, hiérarchie multi-kill
  (`absorbed_kill_ids`), `qc_checks` détaillés, `asset_check`
  (`needs_reclip` + raisons : no_audio, drift_offset, missing_16_9…).
  **La vue `v_clip_ledger_full`** est faite pour une page admin « Ledger »
  (service role uniquement — RLS sans policy anon).
- **`game_vod_sources`** : `drift_samples`, `drift_model` (piecewise),
  `offset_confidence`, `sync_method`, `synced_at` — le modèle de drift
  par source VOD, si tu veux l'afficher par game.

## 🟡 À savoir côté worker (ma branche, merge/rebase sans risque)

`claude/worker-decryptage` touche UNIQUEMENT `worker/`,
`supabase/migrations/`, `docs/` et `web/vercel.json` (garde anti
preview-deploys — aucune page). Zéro overlap avec l'admin backoffice.

Contenu : circuit-breaker 429 Gemini (coupe les 4 process jusqu'au reset
07:00 UTC), pricing des modèles `-preview` corrigé (~6× sous-compté),
pré-filtre harvester anti-réinsertion (les ~50k erreurs Postgres/7j du
dashboard), `[acodec!=none]` yt-dlp (212 clips muets), OCR local du timer
auto-calibré, QC multi-passes, scripts `backfill_au_crible.py` /
`reclip_from_ledger.py` / `repair_published_urls.py`.

⚠️ **Le worker doit être redémarré après pull** (là où il tourne) pour
activer le breaker + le pré-filtre harvester. Et le `.env` local du
worker ne doit PLUS contenir de `GEMINI_MODEL` global (il écrase le
routing par tier — c'est une des causes des 50 € Gemini).

## Pièges permanents (rappel)

1. `content_hash` (index UNIQUE) : JAMAIS dans un PATCH de flip de statut.
2. Dédup = `status='duplicate'` + `is_duplicate_of`, JAMAIS de DELETE.
3. Migrations : numéroter à partir de **091** (088/089/090 prises).
4. Clips servis par R2 uniquement, jamais par Supabase.
