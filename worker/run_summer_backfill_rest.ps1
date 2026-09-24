# Reste de la chaîne Summer après le blocage YouTube du 18/09 11:30 (« Sign in to
# confirm you're not a bot », IP flaggée) : SHFT rejoué + SK + les 2 Bo5 de playoffs.
# Même log de chaîne que run_summer_backfill.ps1 (le suivi détecteur/juge le lit).
param([int]$Only = 0)
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$logDir = "D:\kckills_worker\logs"
$chainLog = Join-Path $logDir "run_summer_backfill_chain.log"
$matches = @(
    @{ id = "115548681803406223"; label = "2026-08-23_SHFT_W5_rejeu" },
    @{ id = "115548681803406259"; label = "2026-08-29_SK_W6" },
    @{ id = "115548681803406291"; label = "2026-09-05_GX_playoffs" },
    @{ id = "115548681803406303"; label = "2026-09-06_G2_playoffs" }
)
$env:PYTHONIOENCODING = "utf-8"
$done = 0
foreach ($m in $matches) {
    if ($Only -gt 0 -and $done -ge $Only) { break }
    $log = Join-Path $logDir ("pipeline_summer_" + $m.label + ".log")
    ("[{0}] pipeline {1} ({2}) -> {3}" -f (Get-Date -Format "HH:mm:ss"), $m.label, $m.id, $log) | ForEach-Object { Write-Host $_; [System.IO.File]::AppendAllText($chainLog, $_ + "`r`n", [System.Text.UTF8Encoding]::new($false)) }
    cmd /c ("""$py"" main.py pipeline " + $m.id + " >> """ + $log + """ 2>&1")
    ("[{0}]   exit {1}" -f (Get-Date -Format "HH:mm:ss"), $LASTEXITCODE) | ForEach-Object { Write-Host $_; [System.IO.File]::AppendAllText($chainLog, $_ + "`r`n", [System.Text.UTF8Encoding]::new($false)) }
    $done++
    Start-Sleep -Seconds 30
}
("[{0}] Terminé : {1} série(s)." -f (Get-Date -Format "HH:mm:ss"), $done) | ForEach-Object { Write-Host $_; [System.IO.File]::AppendAllText($chainLog, $_ + "`r`n", [System.Text.UTF8Encoding]::new($false)) }
