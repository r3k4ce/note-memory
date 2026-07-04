#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"

if ! command -v uv >/dev/null 2>&1; then
    echo "uv was not found on PATH. Install uv, then run 'uv sync --dev' from backend/." >&2
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "npm was not found on PATH. Install Node.js 24 or newer, then run 'npm install' from frontend/." >&2
    exit 1
fi

set -m

processes=()
cleaned_up=0

cleanup() {
    if [[ "$cleaned_up" -eq 1 ]]; then
        return
    fi
    cleaned_up=1

    for process in "${processes[@]}"; do
        if kill -0 "$process" 2>/dev/null; then
            kill -TERM -- "-$process" 2>/dev/null || kill -TERM "$process" 2>/dev/null || true
        fi
    done

    for process in "${processes[@]}"; do
        wait "$process" 2>/dev/null || true
    done
}

trap cleanup EXIT INT TERM

(
    cd "$repo_root/backend"
    exec uv run python -m uvicorn mapping_memory.main:app --reload
) &
processes+=("$!")

(
    cd "$repo_root/frontend"
    exec npm run dev
) &
processes+=("$!")

echo "Backend:  http://localhost:8000"
echo "Frontend: see Vite output above. Press Ctrl+C to stop both."

set +e
wait -n "${processes[@]}"
status=$?
set -e

cleanup
exit "$status"
