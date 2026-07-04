#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"

(
    cd "$repo_root/backend"
    uv run python -m ruff check . --fix
    uv run python -m ruff format .
    uv run python -m ruff check .
    uv run python -m pyright
    uv run python -m pytest
)

(
    cd "$repo_root/frontend"
    npm run test --if-present
    npm run test:e2e --if-present
    npm run lint
    npm run build
)
