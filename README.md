# Note Memory

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
> account configured in `backend/.env` for AI metadata, embeddings, and Ask answers.
> Do not paste confidential or work-restricted material unless your company policy
> explicitly permits sending it to that OpenAI account.
> Without `OPENAI_API_KEY`, notes still save with local fallback metadata but search and Ask
> degrade to exact-match only (Ask answers are disabled).

## What it is

A local-first three-pane notes workspace with AI-assisted metadata, hybrid search,
and grounded Ask/chat over your saved notes.

- **Left sidebar:** search, category filters, note list, search match snippets,
  and Ask scope controls for choosing all notes or selected notes.
- **Center workspace:** capture new Markdown notes, read selected notes, and edit
  the note body, title, summary, tags, and category in one workspace.
- **Right sidebar:** persistent Ask/chat with recent in-session history, selected
  note/category scope, and cited answers from saved notes.

The backend stores notes locally, asks an LLM for title, summary, and tags when
configured, indexes note chunks for retrieval, and exposes search and Ask
endpoints that return sourced results from your own note collection.

## Local-first storage

- **SQLite is the source of truth.** Every note and manual category is written to
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
| `OPENAI_API_KEY` | _empty_ | Enables AI metadata, embeddings, and Ask answers. Leave unset to run with fallback metadata and exact-only search. |
| `OPENAI_ORGANIZER_MODEL` | `gpt-5.4-mini` | Model used to generate note title, summary, and tags, and to answer Ask questions. |
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

## Keyboard shortcuts

The frontend uses Windows-oriented shortcuts. Press `Tab` to move through
controls normally; shortcuts use `Alt`, not `Ctrl`.

| Shortcut | Action | Focus target |
| --- | --- | --- |
| `Alt+1` | Focus new-note editor | Note Markdown editor |
| `Alt+2` | Focus search | Search input |
| `Alt+3` | Focus Ask composer | Ask textarea |
| `Escape` | Leave the current field | Blurs the active control |

## Verify the install

With the backend running on `http://127.0.0.1:8000`:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health

Invoke-RestMethod http://127.0.0.1:8000/notes -Method Post -ContentType "application/json" `
    -Body '{"original_text":"My first note"}'

Invoke-RestMethod "http://127.0.0.1:8000/search?q=note"
Invoke-RestMethod "http://127.0.0.1:8000/search?q=note&uncategorized=true"
Invoke-RestMethod "http://127.0.0.1:8000/search?q=note&category_id=1"

Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" `
    -Body '{"question":"What notes have I saved?"}'
Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" `
    -Body '{"question":"What notes have I saved?","category_id":1}'
Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" `
    -Body '{"question":"What notes have I saved?","note_ids":[1]}'
```

Expected health response: `{ "status": "ok" }`. See `backend/README.md` for the
full list of PowerShell examples covering categories, note body edits, selected-note
Ask scope, chat history, PATCH, and DELETE.

## MVP verification checklist

Walk through these once after a clean install:

- [ ] `Invoke-RestMethod http://127.0.0.1:8000/health` returns `{ "status": "ok" }`
- [ ] `POST /categories` creates a manual category and `GET /categories` lists it
- [ ] `POST /notes` with sample text returns 201 and a note with `ai_title`, `short_summary`, `tags`, and `category`
- [ ] `GET /notes` lists the saved note
- [ ] `GET /notes/{id}` returns the same note
- [ ] `GET /search?q=<term>` returns the note as a search hit and category scope params restrict results
- [ ] `POST /ask` with a question returns an answer with at least one `sources` entry; category scope fields and `note_ids` restrict sources
- [ ] `GET /notes?category_id=<id>` filters notes by category
- [ ] `PATCH /notes/{id}` updates body/title/summary/tags/category and round-trips on the next `GET`
- [ ] `DELETE /notes/{id}` returns `deleted: true`; the note is gone from `GET /notes`
- [ ] Frontend at `http://localhost:5173` loads the three-pane workspace
- [ ] Left sidebar search returns note cards with `Exact`, `Semantic`, or `Hybrid` match chips and matched snippets when available
- [ ] Left sidebar categories filter the note list, search, and Ask scope
- [ ] Left sidebar Ask scope controls switch between all notes, selected notes, and no selected notes
- [ ] Center workspace creates notes, opens selected notes, and edits the saved Markdown body plus metadata
- [ ] Saved note detail renders the note body as Markdown in single-pane read mode
- [ ] Right sidebar Ask/chat persists recent in-session turns and cites saved-note sources
- [ ] `uv run python -m mapping_memory.reindex` rebuilds Chroma from SQLite when run from `backend/` with `OPENAI_API_KEY`

## Where local data is stored

- Notes (canonical): `data/mapping_memory.sqlite`
- Vector index (derived): `data/chroma/`

Both paths are relative to the repository root by default and are listed in
`.gitignore`.

## Rebuild Chroma index

SQLite is the source of truth for saved notes and categories. Chroma stores a
rebuildable retrieval index in `data/chroma/`: embedded note chunks plus metadata
used by semantic search and Ask retrieval.

Run the reindex command when `data/chroma/` is missing, has been deleted, looks
stale, or semantic search / Ask retrieval is not reflecting the notes saved
in SQLite.

Run from `backend/`:

```powershell
uv run python -m mapping_memory.reindex
```

The command requires `OPENAI_API_KEY` because it recreates embeddings. It does
not delete SQLite data.

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

- `backend/README.md` &mdash; full API PowerShell reference, env var defaults, and test instructions.
- `docs/project-memory.yaml` &mdash; chronological slice history and verification notes.
