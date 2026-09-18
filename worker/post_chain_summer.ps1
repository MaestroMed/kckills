# ============================================================
#   KCKILLS — après le rattrapage Summer : qualité + daemon
# ============================================================
#   1. Crible (offset multi-points par game, dédup, ledger, audit des clips)
#      sur les games des matchs Summer 2026 -> détecte les clips à refaire
#      (drift : les kill_visible=false de fin de game, cf. NAVI 18/63).
#   2. Re-clip des kills marqués needs_reclip (QC v2 obligatoire).
#   3. Relance du daemon complet (translator, qc_sampler, quote_extractor,
#      sentinel pour le match de Nice) — détaché.
#   Usage : .\post_chain_summer.ps1            # tout
#           .\post_chain_summer.ps1 -NoDaemon
# ============================================================
param([switch]$NoDaemon, [int]$ReclipLimit = 400)
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$log = "D:\kckills_worker\logs\post_chain_summer.log"
$env:PYTHONIOENCODING = "utf-8"

$matches = "115548681803406199","115548681803406271","115548681803406287","115548681803406171","115548681803406139",
           "115548681803406279","115548681803406243","115548681803406223","115548681803406259","115548681803406291","115548681803406303"

# uuids des games Summer depuis Supabase (REST, clé service du .env)
$envLines = Get-Content ".env" | Where-Object { $_ -match "^(SUPABASE_URL|SUPABASE_SERVICE_KEY)=" }
$cfg = @{}; foreach ($l in $envLines) { $k, $v = $l -split "=", 2; $cfg[$k] = $v.Trim('"') }
$hdr = @{ apikey = $cfg["SUPABASE_SERVICE_KEY"]; Authorization = "Bearer " + $cfg["SUPABASE_SERVICE_KEY"] }
$in = ($matches | ForEach-Object { $_ }) -join ","
$m = Invoke-RestMethod -Headers $hdr -Uri ("{0}/rest/v1/matches?select=id&external_id=in.({1})" -f $cfg["SUPABASE_URL"], $in)
$mids = ($m | ForEach-Object { '"' + $_.id + '"' }) -join ","
$games = Invoke-RestMethod -Headers $hdr -Uri ("{0}/rest/v1/games?select=id,game_number&match_id=in.({1})&kills_extracted=eq.true" -f $cfg["SUPABASE_URL"], $mids)
# 0. MKOI W1 : la game 1 (41 kills) a été harvestée par un run interrompu avant
#    le clip ; pipeline.py (7ad0553) reprend désormais les kills existants sans clip.
Write-Host ("[{0}] reprise MKOI W1 (game 1 orpheline)" -f (Get-Date -Format "HH:mm:ss"))
cmd /c ("""$py"" main.py pipeline 115548681803406271 >> ""D:\kckills_worker\logs\pipeline_summer_2026-07-25_MKOI_W1_reprise.log"" 2>&1")

Write-Host ("[{0}] crible sur {1} games Summer" -f (Get-Date -Format "HH:mm:ss"), $games.Count)

foreach ($g in $games) {
    cmd /c ("""$py"" scripts\backfill_au_crible.py --game " + $g.id + " --apply --probe-assets >> """ + $log + """ 2>&1")
}
Write-Host ("[{0}] re-clip des needs_reclip (limite {1})" -f (Get-Date -Format "HH:mm:ss"), $ReclipLimit)
cmd /c ("""$py"" scripts\reclip_from_ledger.py --apply --limit " + $ReclipLimit + " >> """ + $log + """ 2>&1")

if (-not $NoDaemon) {
    Write-Host ("[{0}] relance du daemon (détaché)" -f (Get-Date -Format "HH:mm:ss"))
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c start_daemon.bat" -WorkingDirectory $PSScriptRoot -WindowStyle Minimized
}
Write-Host "Terminé. Log : $log"
