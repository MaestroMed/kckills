# status-kc.ps1 — Quick health snapshot of the worker
#
# Shows: process state, last log lines, GPU usage, disk free.

$ErrorActionPreference = 'SilentlyContinue'
$root    = Split-Path -Parent $MyInvocation.MyCommand.Definition
$worker  = Join-Path $root 'worker'
$venv    = Join-Path $worker '.venv'
$logDir  = Join-Path $worker 'logs'

Write-Host "=== KC Kills station status ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "[Worker process]" -ForegroundColor White
$procs = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($venv) }
if ($procs) {
    $procs | ForEach-Object {
        $rt = [TimeSpan]::FromSeconds(([DateTime]::UtcNow - $_.CreationDate.ToUniversalTime()).TotalSeconds)
        $ws = [math]::Round($_.WorkingSetSize/1MB, 1)
        Write-Host ("  pid={0}  uptime={1:hh\:mm\:ss}  RSS={2}MB" -f $_.ProcessId, $rt, $ws) -ForegroundColor Green
    }
} else {
    Write-Host "  (no worker process running)" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "[GPU]" -ForegroundColor White
$smi = nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader 2>$null
if ($smi) { Write-Host "  $smi" -ForegroundColor DarkGray } else { Write-Host "  nvidia-smi unavailable" }
Write-Host ""

Write-Host "[Disk C:]" -ForegroundColor White
$d = Get-PSDrive C
"  free={0:N1} GB  used={1:N1} GB" -f ($d.Free/1GB), ($d.Used/1GB) | Write-Host -ForegroundColor DarkGray
Write-Host ""

Write-Host "[Most recent log tail]" -ForegroundColor White
if (Test-Path $logDir) {
    $latest = Get-ChildItem $logDir -Filter 'worker-*.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest) {
        Write-Host "  → $($latest.Name)" -ForegroundColor DarkGray
        Get-Content $latest.FullName -Tail 10 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    } else { Write-Host "  (no logs yet)" }
} else { Write-Host "  (no log dir)" }
