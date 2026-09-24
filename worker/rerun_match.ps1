# Rejoue le pipeline d'un match (idempotent) dans un processus détaché, log UTF-8.
# Usage : Start-Process pwsh -ArgumentList "-NoProfile","-File","rerun_match.ps1","<match_ext_id>","<label>" -WorkingDirectory worker
param([Parameter(Mandatory=$true)][string]$MatchId, [string]$Label = "rejeu")
Set-Location $PSScriptRoot
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$log = "D:\kckills_worker\logs\pipeline_summer_" + $Label + "_" + $MatchId + ".log"
$env:PYTHONIOENCODING = "utf-8"
cmd /c ("""$py"" main.py pipeline " + $MatchId + " >> """ + $log + """ 2>&1")
"[{0}] pipeline {1} ({2}) exit {3}" -f (Get-Date -Format "HH:mm:ss"), $Label, $MatchId, $LASTEXITCODE | Add-Content "D:\kckills_worker\logs\rerun_match.log"
