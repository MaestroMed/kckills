# stop-kc.ps1 — Stop the KCKills worker cleanly
#
# Sends Ctrl-C-equivalent to every python.exe whose command-line
# references the worker venv, then verifies they're gone.

$ErrorActionPreference = 'SilentlyContinue'
$venvPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) 'worker\.venv'

$matches = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($venvPath) }

if (-not $matches) { "No worker process matching $venvPath."; return }

foreach ($p in $matches) {
    Write-Host "→ stop pid=$($p.ProcessId)  $($p.CommandLine)" -ForegroundColor Yellow
    Stop-Process -Id $p.ProcessId -Force
}

Start-Sleep -Seconds 2
$still = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($venvPath) }
if ($still) { Write-Error "Some processes still alive: $($still.ProcessId -join ',')" }
else { Write-Host "✓ all stopped" -ForegroundColor Green }
