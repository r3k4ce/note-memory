$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$UvCommand = Get-Command uv -ErrorAction SilentlyContinue
$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue

if (-not $NpmCommand) {
    $NpmCommand = Get-Command npm -ErrorAction SilentlyContinue
}

if (-not $UvCommand) {
    Write-Error "uv was not found on PATH. Install uv, then run 'uv sync --dev' from backend/."
    exit 1
}

if (-not $NpmCommand) {
    Write-Error "npm was not found on PATH. Install Node.js 24 or newer, then run 'npm install' from frontend/."
    exit 1
}

$Processes = @()

try {
    $Processes += Start-Process $UvCommand.Source -ArgumentList @("run", "python", "-m", "uvicorn", "mapping_memory.main:app", "--reload") -WorkingDirectory (Join-Path $Root "backend") -NoNewWindow -PassThru
    $Processes += Start-Process $NpmCommand.Source -ArgumentList @("run", "dev") -WorkingDirectory (Join-Path $Root "frontend") -NoNewWindow -PassThru

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
