# mapping-memory

![CI](https://img.shields.io/github/actions/workflow/status/r3k4ce/note-memory/ci.yml?branch=main&style=flat-square&label=ci)
![Python](https://img.shields.io/badge/python-3.12%2B-blue?style=flat-square)
![Node](https://img.shields.io/badge/node-24%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![License](https://img.shields.io/github/license/r3k4ce/note-memory?style=flat-square)
![Last commit](https://img.shields.io/github/last-commit/r3k4ce/note-memory?style=flat-square)

FastAPI &middot; React &middot; TypeScript &middot; SQLite (FTS5) &middot; ChromaDB &middot; OpenAI

> [!WARNING]
> **Privacy and work data.**
>
> All notes are stored locally on this machine in `data/` (SQLite) and a local Chroma index.
> When `OPENAI_API_KEY` is set, note text and your questions are sent to the OpenAI API
> account configured in `backend/.env` for AI metadata, embeddings, and ask-mode answers.
> Do not paste confidential or work-restricted material unless your company policy
> explicitly permits sending it to that OpenAI account.
> Without `OPENAI_API_KEY`, notes still save with local fallback metadata but search and ask
> degrade to exact-match only (ask-mode is disabled).

## What it is

A local-first notes workspace with AI-assisted metadata, hybrid search, and grounded
ask-mode. Add free-form notes; the backend asks an LLM to produce a title, summary,
and tags, indexes the note for retrieval, and exposes search and ask endpoints that
return sourced answers from your own note collection.

## Local-first storage

- **SQLite is the source of truth.** Every note is written to
  `data/mapping_memory.sqlite` first; if anything else (AI metadata, embeddings,
  Chroma indexing) fails, the saved note is still there.
- **Chroma is rebuildable.** The vector index in `data/chroma/` is a derived cache.
  It can be deleted at any time and re-created from SQLite. Search and ask will
  fall back to exact-match only while the index is empty or unavailable.
- No cloud sync, no telemetry, no remote backup. The data folder is yours.

## Prerequisites

- Python 3.12 or newer
- [uv](https://docs.astral.sh/uv/) for backend dependency management
- Node.js 24 or newer and npm
- Windows PowerShell 5.1+ (the commands below use PowerShell-native syntax)

## Setup

### 1. Backend

```powershell
Push-Location backend
uv sync --dev
Pop-Location
```

### 2. Frontend

```powershell
Push-Location frontend
npm install
Pop-Location
```

### 3. Environment variables

The backend reads `backend/.env` on startup. Copy `backend/.env.example` to
`backend/.env` only when you are ready to provide a real key. **Never commit
`backend/.env`.**

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | _empty_ | Enables AI metadata, embeddings, and ask mode. Leave unset to run with fallback metadata and exact-only search. |
| `OPENAI_ORGANIZER_MODEL` | `gpt-5.4-mini` | Model used to generate note title, summary, and tags, and to answer ask-mode questions. |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | Model used to embed retrieval chunks and search/ask queries. |
| `SQLITE_PATH` | `../data/mapping_memory.sqlite` | SQLite database file (canonical note storage). Resolved relative to `backend/`. |
| `CHROMA_PATH` | `../data/chroma` | Chroma persistent index directory. Rebuildable from SQLite. Resolved relative to `backend/`. |

The frontend reads `VITE_BACKEND_BASE_URL` at build time. If unset, it defaults to
`http://localhost:8000`.

## Run

### Both at once

```powershell
.\scripts\run.ps1
```

Press `Ctrl+C` to stop both processes. The runner cleans up the backend and Vite
process trees on exit.

### Backend only

```powershell
Push-Location backend
uv run python -m uvicorn mapping_memory.main:app --reload
Pop-Location
```

### Frontend only

```powershell
Push-Location frontend
npm run dev
Pop-Location
```

## Verify the install

With the backend running on `http://127.0.0.1:8000`:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health

Invoke-RestMethod http://127.0.0.1:8000/notes -Method Post -ContentType "application/json" `
    -Body '{"original_text":"My first mapping note"}'

Invoke-RestMethod "http://127.0.0.1:8000/search?q=mapping"

Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" `
    -Body '{"question":"What mapping notes have I saved?"}'
```

Expected health response: `{ "status": "ok" }`. See `backend/README.md` for the
full list of curl examples covering PATCH and DELETE.

## MVP verification checklist

Walk through these once after a clean install:

- [ ] `Invoke-RestMethod http://127.0.0.1:8000/health` returns `{ "status": "ok" }`
- [ ] `POST /notes` with sample text returns 201 and a note with `ai_title`, `short_summary`, `tags`
- [ ] `GET /notes` lists the saved note
- [ ] `GET /notes/{id}` returns the same note
- [ ] `GET /search?q=<term>` returns the note as a search hit
- [ ] `POST /ask` with a question returns an answer with at least one `sources` entry
- [ ] `PATCH /notes/{id}` updates title/summary/tags and round-trips on the next `GET`
- [ ] `DELETE /notes/{id}` returns `deleted: true`; the note is gone from `GET /notes`
- [ ] Frontend at `http://localhost:5173` loads and Add, Search, and Ask panels work end-to-end

## Where local data is stored

- Notes (canonical): `data/mapping_memory.sqlite`
- Vector index (derived): `data/chroma/`

Both paths are relative to the repository root by default and are listed in
`.gitignore`.

## Reset local data

> [!WARNING]
> **Destructive.** This deletes every saved note and the local Chroma index.
> Stop the backend first (`Ctrl+C` in `scripts\run.ps1`, or stop the uvicorn
> process), then run:

```powershell
Remove-Item -LiteralPath data/mapping_memory.sqlite
Remove-Item -LiteralPath data/chroma -Recurse -Force
```

Restart the backend afterwards; it will recreate the SQLite schema and an empty
Chroma index. Notes deleted this way cannot be recovered.

## MVP non-goals

- No authentication or multi-user support
- No cloud sync, remote backup, or telemetry
- No Gmail, Google Drive, or other third-party integrations
- No deployment guide (the app runs on `localhost`)
- No browser automation or scraping

These are conscious omissions for the MVP. See the project memory file for the
slices that delivered the current scope.

## Backend tests

```powershell
Push-Location backend
uv run python -m pytest
Pop-Location
```

To run format, lint, typecheck, and tests together (backend) plus lint and
build (frontend), use the repo-level check script:

```powershell
.\scripts\check.ps1
```

## Project structure

```
backend/         FastAPI app, SQLite + Chroma, AI/embedding/ask modules
frontend/        React + TypeScript + Vite single-page workspace
scripts/         PowerShell helpers (check, fix, run)
data/            Local-only runtime data (gitignored)
docs/            Project memory and slice history
```

## Docs

- `backend/README.md` &mdash; full API curl reference, env var defaults, and test instructions.
- `docs/project-memory.yaml` &mdash; chronological slice history and verification notes.
