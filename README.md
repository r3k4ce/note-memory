# Note Memory

![CI](https://img.shields.io/github/actions/workflow/status/r3k4ce/note-memory/ci.yml?branch=main&style=flat-square&label=ci)
![Python](https://img.shields.io/badge/python-3.12%2B-blue?style=flat-square)
![Node](https://img.shields.io/badge/node-24%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![License](https://img.shields.io/github/license/r3k4ce/note-memory?style=flat-square)
![Last commit](https://img.shields.io/github/last-commit/r3k4ce/note-memory?style=flat-square)

FastAPI &middot; React &middot; TypeScript &middot; SQLite (FTS5) &middot; RapidFuzz &middot; ChromaDB &middot; OpenAI

> [!WARNING]
> **Privacy and work data.**
>
> All notes are stored locally on this machine in `data/` (SQLite) and a local Chroma index.
> When `OPENAI_API_KEY` is set, note text and your questions are sent to the OpenAI API
> account configured in `backend/.env` for AI metadata, embeddings, and Ask answers.
> Do not paste confidential or work-restricted material unless your company policy
> explicitly permits sending it to that OpenAI account.
> Without `OPENAI_API_KEY`, notes still save with local fallback metadata but search uses
> local exact and fuzzy matching only (Ask answers are disabled).

## What it is

A local-first three-pane notes workspace with AI-assisted metadata, hybrid search,
and grounded Ask/chat over your saved notes.

The workspace includes a theme switcher in the sidebar header. The Sun/Moon
icon toggles between light and dark; the small chevron next to it opens a menu
of variants for the current mode. Available themes:

- **Midnight** (dark, default) — zinc surfaces with an amber accent.
- **Forest** (dark) — moss-green surfaces with a lime accent.
- **Daylight** (light) — neutral light surfaces with an amber accent.
- **Solarized** (light) — classic Solarized Light palette with a blue accent.

The choice persists in `localStorage`.

- **Left sidebar:** explicit Browse and Search tabs, a collapsed category manager
  for creating/renaming/deleting categories, a browse category tree with nested
  notes that can be dragged between categories, search match snippets, and
  visible Ask source checkboxes for all notes, categories, and individual notes.
- **Center workspace:** write new Markdown notes and open selected notes in the
  same full-height Markdown editor. Title, summary, tags, and category are
  edited through an Obsidian-compatible YAML frontmatter block, with a subtle
  Read Mode toolbar button for in-place rendered preview.
  Edit-mode Markdown uses an Obsidian-lite live preview for common inactive
  Markdown and GFM syntax while preserving raw Markdown.
- **Right sidebar:** persistent Ask/chat with recent in-session history, explicit
  Ask source scope, cited answers, and source snippets whose note links open
  saved notes.

The backend stores notes locally in SQLite and writes saved notes as Markdown
files with YAML frontmatter, asks an LLM for title, summary, and tags when
configured, indexes note chunks for retrieval, and exposes search and Ask
endpoints that return sourced results from your own note collection.

## Local-first storage

- **SQLite is the source of truth.** Every note and manual category is written to
  `data/mapping_memory.sqlite` first; if anything else (AI metadata, embeddings,
  Chroma indexing) fails, the saved note is still there.
- **Markdown is written on save.** Creating, editing, deleting, or uncategorizing
  notes updates `data/vault/`; app startup does not import Markdown files or
  generate missing files for older SQLite rows.
- **Chroma is rebuildable.** The vector index in `data/chroma/` is a derived cache.
  It can be deleted at any time and re-created from SQLite. Creating, editing,
  deleting, and category changes update Chroma best-effort. On startup, the
  backend compares SQLite notes against stored Chroma chunk metadata and rebuilds
  the index when it is empty, incomplete, or stale and `OPENAI_API_KEY` is
  configured. Search falls back to local exact and fuzzy matching while the index
  is empty or unavailable. Ask uses Chroma for semantic retrieval and also
  rescues explicitly selected notes from SQLite when vector retrieval misses them.
- No cloud sync, no telemetry, no remote backup. The data folder is yours.

## Prerequisites

- Python 3.12 or newer
- [uv](https://docs.astral.sh/uv/) for backend dependency management
- Node.js 24 or newer and npm
- Windows PowerShell 5.1+ for `.ps1` scripts, or Bash for `.sh` scripts

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
| `OPENAI_API_KEY` | _empty_ | Enables AI metadata, embeddings, and Ask answers. Leave unset to run with fallback metadata plus local exact/fuzzy search. |
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

```bash
./scripts/run.sh
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
| `Alt+2` | Open Search tab | Search input |
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
Invoke-RestMethod "http://127.0.0.1:8000/search?q=note&semantic=false"

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
- [ ] `POST /categories` creates a manual category, `PATCH /categories/{id}` renames it, `GET /categories` lists it, and `DELETE /categories/{id}` deletes it with its notes
- [ ] `POST /notes` with sample text returns 201 and a note with `ai_title`, `short_summary`, `tags`, and `category`
- [ ] `GET /notes` lists the saved note
- [ ] `GET /notes/{id}` returns the same note
- [ ] `GET /search?q=<term>` returns the note as a search hit and category scope params restrict results
- [ ] `POST /ask` with a question returns an answer with at least one `sources` entry and snippet; category scope fields and `note_ids` restrict sources
- [ ] `GET /notes?category_id=<id>` filters notes by category
- [ ] `PATCH /notes/{id}` updates body/title/summary/tags/category and round-trips on the next `GET`
- [ ] `DELETE /notes/{id}` returns `deleted: true`; the note is gone from `GET /notes`
- [ ] Frontend at `http://localhost:5173` loads the three-pane workspace
- [ ] Left sidebar Search tab returns live local results while typing, full hybrid results on Enter, and note cards with `Exact`, `Fuzzy`, `Semantic`, or `Hybrid` match chips and matched snippets when available
- [ ] Left sidebar Browse tab starts with collapsed category folders, supports dragging notes between categories, and has a collapsed category manager for create/rename/delete
- [ ] Left sidebar Ask source checkboxes switch between all notes, category-selected notes, individual notes, and no selected notes
- [ ] Center workspace creates notes, opens selected notes in the same editor surface, and edits the saved Markdown body plus YAML metadata frontmatter
- [ ] Read Mode renders new-note drafts and saved-note bodies as Markdown in place
- [ ] Right sidebar Ask/chat persists recent in-session turns and cites saved-note sources with snippets
- [ ] `uv run python -m mapping_memory.reindex` rebuilds Chroma from SQLite when run from `backend/` with `OPENAI_API_KEY`

## Where local data is stored

- Note database and local index: `data/mapping_memory.sqlite`
- Markdown vault: `data/vault/`
- Vector index (derived): `data/chroma/`

Both paths are relative to the repository root by default and are listed in
`.gitignore`.

## Rebuild Chroma index

SQLite is the source of truth for saved notes and categories. Chroma stores a
rebuildable retrieval index in `data/chroma/`: embedded note chunks plus metadata
used by semantic search and Ask retrieval.

Backend startup checks SQLite notes against Chroma chunk metadata and rebuilds
the Chroma collection when it is empty, incomplete, or stale and
`OPENAI_API_KEY` is configured. Run the reindex command manually when
`data/chroma/` is missing, has been deleted, looks stale, or semantic search /
Ask retrieval is not reflecting the notes saved in SQLite. Reindex after Ask
retrieval changes so stored chunk metadata, including source offsets and sync
hashes, is refreshed.

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
Remove-Item -Path data/vault/*.md
Remove-Item -LiteralPath data/chroma -Recurse -Force
```

Restart the backend afterwards; it will recreate the SQLite schema. Notes deleted
this way cannot be recovered.

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

To run format, lint, typecheck, and tests together (backend) plus tests, lint,
and build (frontend), use the repo-level check script:

```powershell
.\scripts\check.ps1
```

```bash
./scripts/check.sh
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
