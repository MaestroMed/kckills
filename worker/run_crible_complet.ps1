# Chaîne complète du crible — lancé détaché par la session Fable 2026-07-14.
# 1. backfill au crible (dédup + décryptage + ledger + audit) sur TOUTES les games
# 2. re-clips des clips cassés/driftés détectés, gate QC v2 obligatoire
# Logs : worker/logs/crible_backfill.log + crible_reclip.log
# Résumable : backfill_au_crible_state.json (relancer ce script reprend où c'était).
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot "logs") | Out-Null

& $py -u scripts/backfill_au_crible.py --apply --all --probe-assets --gemini-budget 8 `
    *>> (Join-Path $PSScriptRoot "logs\crible_backfill.log")

& $py -u scripts/reclip_from_ledger.py --apply --limit 600 `
    *>> (Join-Path $PSScriptRoot "logs\crible_reclip.log")

"CRIBLE COMPLET TERMINE $(Get-Date -Format o)" >> (Join-Path $PSScriptRoot "logs\crible_backfill.log")
