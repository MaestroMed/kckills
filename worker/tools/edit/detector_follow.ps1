# Suit la chaîne de rattrapage Summer : à chaque match terminé (ligne "exit" dans
# le log de la chaîne), lance le détecteur de moves (Gemini 3.8 Flash) sur ses
# clips publiés, puis la validation. S'arrête quand la chaîne écrit "Terminé".
# Lancé détaché : Start-Process pwsh -ArgumentList "-File detector_follow.ps1"
$chain = "D:\kckills_worker\logs\run_summer_backfill_chain.log"
$state = "D:\kckills_worker\edit_summer\detector_follow_state.txt"
$log = "D:\kckills_worker\edit_summer\detector_follow.log"
$py = "C:\Users\Matter1\Karmine_Stats\worker\.venv\Scripts\python.exe"
$det = "C:\Users\Matter1\AppData\Local\Temp\claude\C--Users-Matter1-Karmine-Stats\fd64f1f7-799f-448b-90cd-ed702400c318\scratchpad\move_detector.py"
$val = "C:\Users\Matter1\AppData\Local\Temp\claude\C--Users-Matter1-Karmine-Stats\fd64f1f7-799f-448b-90cd-ed702400c318\scratchpad\validate_match.py"
$env:PYTHONIOENCODING = "utf-8"
if (-not (Test-Path $state)) { "115548681803406171`n115548681803406199`n115548681803406271" | Set-Content $state }
while ($true) {
    $done = @(Get-Content $state | Where-Object { $_ })
    $lines = Get-Content $chain
    $pending = $null
    foreach ($l in $lines) {
        if ($l -match 'pipeline \S+ \((\d+)\)') { $pending = $Matches[1] }
        elseif ($l -match '\]\s+exit \d+' -and $pending -and ($done -notcontains $pending)) {
            $id = $pending
            "[{0}] détecteur sur {1}" -f (Get-Date -Format "HH:mm:ss"), $id | Tee-Object -FilePath $log -Append
            cmd /c ("""$py"" """ + $det + """ 300 " + $id + " >> """ + $log + """ 2>&1")
            cmd /c ("""$py"" """ + $val + """ " + $id + " >> """ + $log + """ 2>&1")
            Add-Content $state $id
            $done += $id
        }
    }
    if (($lines -join "`n") -match "Terminé") {
        "[{0}] chaîne terminée, fin du suivi" -f (Get-Date -Format "HH:mm:ss") | Tee-Object -FilePath $log -Append
        break
    }
    Start-Sleep -Seconds 120
}
