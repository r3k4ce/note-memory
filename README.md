# mapping-memory

## Setup

    Push-Location backend; uv sync --dev; Pop-Location
    Push-Location frontend; npm install; Pop-Location

Copy backend/.env.example to backend/.env only when real secrets are needed. Never commit .env files.

## Commands

Backend source lives in backend/src/mapping_memory/. Frontend source lives in frontend/src/.

    .\scripts\check.ps1
    .\scripts\fix.ps1
    .\scripts\run.ps1
    Push-Location backend; uv run uvicorn mapping_memory.main:app --reload; Pop-Location
    Push-Location frontend; npm run dev; Pop-Location

The frontend calls `http://localhost:8000` by default. To point it elsewhere, set `VITE_BACKEND_BASE_URL` before starting Vite.

## Docs

Project memory lives in docs/project-memory.yaml.
