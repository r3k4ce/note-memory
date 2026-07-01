$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Npm = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { "npm.cmd" } else { "npm" }
$Processes = @()

try {
    $Processes += Start-Process uv -ArgumentList @("run", "uvicorn", "mapping_memory.main:app", "--reload") -WorkingDirectory (Join-Path $Root "backend") -NoNewWindow -PassThru
    $Processes += Start-Process $Npm -ArgumentList @("run", "dev") -WorkingDirectory (Join-Path $Root "frontend") -NoNewWindow -PassThru

    Write-Host "Backend:  http://localhost:8000"
    Write-Host "Frontend: see Vite output above. Press Ctrl+C to stop both."

    while (-not ($Processes | Where-Object { $_.HasExited })) {
        Start-Sleep -Seconds 1
    }
}
finally {
    foreach ($Process in $Processes) {
        if ($Process -and -not $Process.HasExited) {
            taskkill.exe /PID $Process.Id /T /F | Out-Null
        }
    }
}
