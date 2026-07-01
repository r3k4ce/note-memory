$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [Parameter(Mandatory)] [string]$Command,
        [Parameter(ValueFromRemainingArguments)] [string[]]$Arguments
    )

    & $Command @Arguments

    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

$Npm = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { "npm.cmd" } else { "npm" }

Push-Location backend
try {
    Invoke-Checked uv run python -m ruff check . --fix
    Invoke-Checked uv run python -m ruff format .
    Invoke-Checked uv run python -m ruff check .
    Invoke-Checked uv run python -m pyright
    Invoke-Checked uv run python -m pytest
}
finally {
    Pop-Location
}

Push-Location frontend
try {
    Invoke-Checked $Npm run test --if-present
    Invoke-Checked $Npm run test:e2e --if-present
    Invoke-Checked $Npm run lint
    Invoke-Checked $Npm run build
}
finally {
    Pop-Location
}
