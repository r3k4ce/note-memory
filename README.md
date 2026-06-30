# mapping-memory

## Setup

    Push-Location backend; uv sync --dev; Pop-Location
    Push-Location frontend; npm install; Pop-Location

Copy backend/.env.example to backend/.env only when real secrets are needed. Never commit .env files.

## Commands

Backend source lives in backend/src/mapping_memory/. Frontend source lives in frontend/src/.

    .\scripts\check.ps1
    .\scripts\fix.ps1
    Push-Location frontend; npm run dev; Pop-Location

## Docs

Project memory lives in docs/project-memory.yaml.