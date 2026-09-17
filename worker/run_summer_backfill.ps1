# ============================================================
#   KCKILLS — rattrapage LEC Summer 2026 + playoffs
# ============================================================
#   Enchaîne `main.py pipeline <match>` sur les séries KC jamais traitées
#   (le worker était éteint du 24/07 au 17/09). Un match à la fois — le
#   pipeline est idempotent (upserts partout), relancer ne casse rien.
#
#   Prérequis : serveur PO token bgutil sur 127.0.0.1:4416 (YouTube 403
#   sinon) — start_daemon.bat le lance, sinon :
#     node D:\kckills_worker\tools\bgutil-ytdlp-pot-provider\server\build\main.js
#
#   Usage :  .\run_summer_backfill.ps1            # tout
#            .\run_summer_backfill.ps1 -Only 3    # les 3 premiers restants
# ============================================================
param([int]$Only = 0)

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$logDir = "D:\kckills_worker\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# Ordre chronologique (ids lolesports vérifiés le 17/09/2026 via getSchedule).
$matches = @(
    @{ id = "115548681803406271"; label = "2026-07-25_MKOI_W1" },   # 0-2, 25 kills bruts jamais clippés
    @{ id = "115548681803406287"; label = "2026-07-26_G2_W1" },
    @{ id = "115548681803406139"; label = "2026-08-03_TH_W2" },
    @{ id = "115548681803406279"; label = "2026-08-09_FNC_W3" },
    @{ id = "115548681803406243"; label = "2026-08-17_GX_W4" },
    @{ id = "115548681803406223"; label = "2026-08-23_SHFT_W5" },
    @{ id = "115548681803406259"; label = "2026-08-29_SK_W6" },
    @{ id = "115548681803406291"; label = "2026-09-05_GX_playoffs" },
    @{ id = "115548681803406303"; label = "2026-09-06_G2_playoffs" }
)
# NAVI (115548681803406171, 01/08) est traité à part comme preuve — ajoute-le
# ici s'il faut le relancer.

$env:PYTHONIOENCODING = "utf-8"
$done = 0
foreach ($m in $matches) {
    if ($Only -gt 0 -and $done -ge $Only) { break }
    $log = Join-Path $logDir ("pipeline_summer_" + $m.label + ".log")
    Write-Host ("[{0}] pipeline {1} ({2}) -> {3}" -f (Get-Date -Format "HH:mm:ss"), $m.label, $m.id, $log)
    & $py main.py pipeline $m.id *>> $log
    Write-Host ("[{0}]   exit {1}" -f (Get-Date -Format "HH:mm:ss"), $LASTEXITCODE)
    $done++
    Start-Sleep -Seconds 30   # laisse respirer YouTube / ffmpeg entre deux séries
}
Write-Host "Terminé : $done série(s) traitée(s). Logs dans $logDir"
