# ============================================================
#   Réanalyse du catalogue publié, une tranche par jour
# ============================================================
#
#   scripts/reanalyze_published.py remplace les ~2 400 descriptions
#   provisoires (« analyse IA en attente ») ou désaccentuées par une vraie
#   analyse Gemini du clip. Le quota Gemini est partagé (950 appels et
#   10 $ par jour, remise à zéro à 07:00 UTC) : on en prend 700 par jour
#   pour laisser de la marge au démon et au rattrapage.
#
#   Boucle : attendre 07:10 UTC -> une tranche -> recommencer le
#   lendemain, jusqu'à ce qu'il ne reste rien (5 jours au plus).
#   Lancement détaché (survit à la fermeture de la session) :
#     Invoke-CimMethod Win32_Process Create -Arguments @{CommandLine =
#       'powershell -NoProfile -File C:\...\worker\run_reanalyze_daily.ps1'}
#   Arrêt : Stop-Process sur le powershell.exe qui l'exécute.
# ============================================================

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$env:PYTHONIOENCODING = 'utf-8'
$log = 'D:\kckills_worker\logs\reanalyze_daily.log'

for ($day = 0; $day -lt 5; $day++) {
    $now = [DateTime]::UtcNow
    $next = $now.Date.AddHours(7).AddMinutes(10)
    if ($now -ge $next) { $next = $next.AddDays(1) }
    Add-Content -Path $log -Encoding UTF8 -Value "[$([DateTime]::UtcNow.ToString('s'))Z] attente de la remise à zéro du quota : $($next.ToString('s'))Z"
    Start-Sleep -Seconds ([int][Math]::Ceiling(($next - [DateTime]::UtcNow).TotalSeconds))

    # cmd : journal en UTF-8 (sous PowerShell 5, *>> écrit en UTF-16)
    cmd /c ".venv\Scripts\python.exe scripts\reanalyze_published.py --limit 700 --max-usd 3 >> $log 2>&1"

    $left = & .venv\Scripts\python.exe scripts\reanalyze_published.py --dry-run 2>$null |
        Select-String -Pattern '^(\d+) kills' | ForEach-Object { [int]$_.Matches[0].Groups[1].Value } |
        Select-Object -First 1
    Add-Content -Path $log -Encoding UTF8 -Value "[$([DateTime]::UtcNow.ToString('s'))Z] reste à réanalyser : $left"
    if ($left -eq 0) { break }
}
