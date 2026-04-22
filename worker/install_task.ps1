# ============================================================
#   KCKILLS Worker — install Windows Scheduled Task
# ============================================================
#
#   Registers a scheduled task that runs start_daemon.bat at user
#   logon, and restarts it if it ever stops. The .bat itself loops
#   on crash so you get two layers of resilience: per-process
#   restart in the .bat (10s after crash), full re-launch by the
#   scheduler if the .bat process dies entirely.
#
#   Run this script ONCE in an elevated PowerShell:
#     Right-click PowerShell -> "Run as administrator"
#     cd C:\Users\Matter1\Karmine_Stats\worker
#     .\install_task.ps1
#
#   To uninstall later:
#     Unregister-ScheduledTask -TaskName "KCKills Worker" -Confirm:$false
#
#   To check status:
#     Get-ScheduledTask -TaskName "KCKills Worker" | Get-ScheduledTaskInfo
#
#   To trigger a run right now (testing):
#     Start-ScheduledTask -TaskName "KCKills Worker"
# ============================================================

$TaskName = "KCKills Worker"
$WorkerDir = $PSScriptRoot
$BatPath = Join-Path $WorkerDir "start_daemon.bat"

if (-not (Test-Path $BatPath)) {
    Write-Error "start_daemon.bat not found at $BatPath"
    exit 1
}

# Action: run the .bat
$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$BatPath`"" -WorkingDirectory $WorkerDir

# Trigger 1: at user logon
$TriggerLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Trigger 2: 1 min after machine startup (catches reboot scenarios)
$TriggerBoot = New-ScheduledTaskTrigger -AtStartup
$TriggerBoot.Delay = "PT1M"

# Settings: don't stop if running long, restart on failure, allow on battery
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 99 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 365) `
    -MultipleInstances IgnoreNew

# Run as the current user, in the user's interactive session (so it can spawn ffmpeg subprocess)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# Wipe any previous registration first (idempotent)
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing '$TaskName' registration..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Register the new task
Write-Host "Registering scheduled task '$TaskName'..." -ForegroundColor Cyan
Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger @($TriggerLogon, $TriggerBoot) `
    -Settings $Settings `
    -Principal $Principal `
    -Description "KCKills worker daemon (sentinel/harvester/clipper/analyzer/og/hls). Auto-restarts on crash or reboot."

Write-Host ""
Write-Host "Task installed." -ForegroundColor Green
Write-Host ""
Write-Host "Verify:    Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host "Start now: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Logs:      $WorkerDir\logs\daemon.log"
Write-Host "Stop:      Stop-ScheduledTask -TaskName '$TaskName'"
Write-Host "Uninstall: Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
