# ============================================================
#   Après le rattrapage Twitch du Summer : remise en ordre des données,
#   puis montage V3 (sans musique) dès la remise à zéro du quota Gemini
# ============================================================
#
#   1. attend la fin de scripts/twitch_backfill.py (le rattrapage en cours)
#   2. repair_publication_state --apply : kills republiés restés masqués,
#      portes des game_events périmées (le rattrapage en cours tourne avec
#      l'ancien code, qui n'écrivait que `status`)
#   3. convert_game_time_chrono --apply : chrono des nouvelles games calées
#   4. attend 07:01 UTC (quota Gemini remis à zéro), puis juge v3 :
#      objectifs + survies + kills marquants sur les sections 1080p60
#   5. plan V3 (60 s) + rendu -> Downloads\KC_Summer2026_edit_V3_sans_musique.mp4
#      (la musique « 94 » s'ajoute ensuite : beats.py -> build_plan --music)
#   6. horloges des autres games de 2026 (parcours du feed, pas de Gemini)
#      puis nouvelle conversion du chrono
#
#   Journal : D:\kckills_worker\logs\post_backfill_v3.log (UTF-8, via cmd)
# ============================================================

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$env:PYTHONIOENCODING = 'utf-8'
$log = 'D:\kckills_worker\logs\post_backfill_v3.log'
$ws = 'D:\kckills_worker\edit_summer'
$py = '.venv\Scripts\python.exe'

function Log($msg) {
    Add-Content -Path $log -Encoding UTF8 -Value "[$([DateTime]::UtcNow.ToString('s'))Z] $msg"
}
function Step($args_line) {
    Log "lance : $args_line"
    cmd /c "$py $args_line >> $log 2>&1"
}

# 1. fin du rattrapage
while (Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
        Where-Object { $_.CommandLine -like '*twitch_backfill.py*' }) {
    Start-Sleep -Seconds 60
}
Log "rattrapage terminé"

# 2-3. données
Step "scripts\repair_publication_state.py --apply"
Step "scripts\convert_game_time_chrono.py --apply"

# 4. quota Gemini remis à zéro à 07:00 UTC
$now = [DateTime]::UtcNow
$reset = $now.Date.AddHours(7).AddMinutes(1)
if ($now -lt $reset) {
    Log "attente de 07:01 UTC (quota Gemini)"
    Start-Sleep -Seconds ([int][Math]::Ceiling(($reset - [DateTime]::UtcNow).TotalSeconds))
}
Step "tools\edit\objective_judge.py --only-cached --kills --limit 160 --per-game 8"

# 5. plan + rendu sans musique
if (-not (Test-Path "$ws\detector_empty.jsonl")) { New-Item -ItemType File "$ws\detector_empty.jsonl" | Out-Null }
Step "tools\edit\build_plan.py --detector $ws\detector_empty.jsonl --objectives $ws\objectives_judged_v3.jsonl --min-spectacle 6 --target 60 --out $ws\plan_v3.json"
Step "tools\edit\assemble.py $ws\plan_v3.json $env:USERPROFILE\Downloads\KC_Summer2026_edit_V3_sans_musique.mp4"

# 6. horloges des autres games de 2026 + chrono
Step "scripts\convert_game_time_chrono.py --build-missing --since 2026-01-01 --apply"
Log "fin"
