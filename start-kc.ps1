# start-kc.ps1 — Launch the KCKills worker (24/7 station)
#
# Usage:
#   pwsh ./start-kc.ps1                  # supervised daemon (default)
#   pwsh ./start-kc.ps1 sentinel         # one-shot module run
#   pwsh ./start-kc.ps1 pipeline <id>    # end-to-end on one match
#
# The worker runs in the foreground in this terminal. Ctrl-C to stop
# (or use stop-kc.ps1 from another window).

[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments=$true)] [string[]] $Args)

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$worker = Join-Path $root 'worker'
$venvPy = Join-Path $worker '.venv\Scripts\python.exe'
$envFile = Join-Path $worker '.env'
$logDir = Join-Path $worker 'logs'

if (-not (Test-Path $venvPy)) {
    Write-Error "venv missing at $venvPy. Run setup first."
}
if (-not (Test-Path $envFile)) {
    Write-Warning "No worker/.env found. Worker will likely fail on first DB call."
}
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# UTF-8 console (worker also enforces this internally, but belt-and-braces)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUNBUFFERED = '1'

# Reload PATH from registry — when the launcher is spawned by an
# automation tool, the inherited environment can be missing the User
# PATH entries (winget installs land there). The worker shells out to
# ffmpeg / ffprobe / yt-dlp by bare name, so they MUST be on PATH or
# every clipper / hls_packager call fails with "WinError 2".
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

# Defense-in-depth — verify the binaries the worker needs are actually
# resolvable now. If a winget upgrade renamed a path or PATH refresh
# didn't pick up a recent install, error early with a clear message
# rather than letting the daemon boot then crash 30s later mid-encode.
foreach ($bin in @('ffmpeg', 'ffprobe', 'yt-dlp')) {
    if (-not (Get-Command $bin -ErrorAction SilentlyContinue)) {
        Write-Error "$bin not on PATH. Re-run setup or manually add the winget package dir to User PATH."
    }
}

# Tag this host so Sentry / logs can identify the station
if (-not $env:WORKER_HOSTNAME) { $env:WORKER_HOSTNAME = $env:COMPUTERNAME }

Set-Location $worker
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$logFile = Join-Path $logDir "worker-$ts.log"
Write-Host "→ worker  $venvPy main.py $($Args -join ' ')" -ForegroundColor Cyan
Write-Host "→ logs    $logFile" -ForegroundColor DarkGray
Write-Host "→ host    $env:WORKER_HOSTNAME" -ForegroundColor DarkGray
Write-Host ""
& $venvPy main.py @Args 2>&1 | Tee-Object -FilePath $logFile
