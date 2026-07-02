# Note Memory Backend

## Setup

```powershell
uv sync --dev
```

The backend starts without `backend/.env` and without `OPENAI_API_KEY`. When `OPENAI_API_KEY` is configured, note creation attempts AI metadata and falls back to local metadata if AI is unavailable. After a note is saved to SQLite, note creation also attempts retrieval chunking, embeddings, and Chroma indexing; indexing failures are logged and do not roll back the saved note. Embeddings use `OPENAI_EMBEDDING_MODEL`, defaulting to `text-embedding-3-small`. The local Chroma vector store uses `CHROMA_PATH`, defaulting to `../data/chroma`, and remains rebuildable rather than canonical storage.

## Run

```powershell
uv run python -m uvicorn mapping_memory.main:app --reload
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

Expected response:

```json
{ "status": "ok" }
```

Create a category:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/categories -Method Post -ContentType "application/json" -Body '{"name":"Work"}'
```

List categories:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/categories
```

Create a note:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/notes -Method Post -ContentType "application/json" -Body '{"original_text":"My note","category_id":1}'
```

List notes:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/notes
Invoke-RestMethod "http://127.0.0.1:8000/notes?category_id=1"
```

Get one note:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/notes/1
```

Update note body or metadata:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/notes/1 -Method Patch -ContentType "application/json" -Body '{"original_text":"Updated note body","ai_title":"Corrected title","short_summary":"Corrected summary.","tags":["routing","labels"],"category_id":null}'
```

Body and metadata updates refresh SQLite FTS and attempt Chroma reindexing. Chroma reindex failures are logged and do not roll back the saved note update.

Delete one note:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/notes/1 -Method Delete
```

Delete removes the SQLite note, refreshes SQLite FTS, and attempts Chroma chunk cleanup. Chroma cleanup failures are logged and returned in `vector_cleanup` without restoring the deleted note.

## Rebuild the Chroma index

SQLite is the source of truth for saved notes and categories. Chroma stores the
derived retrieval index: embedded chunks of saved notes plus metadata used by
semantic search and ask-mode retrieval.

Chroma is rebuildable. Run the reindex command when the Chroma directory is
missing, has been deleted, looks stale, or semantic search / ask-mode retrieval
is not reflecting the notes saved in SQLite.

Run from `backend/`:

```powershell
uv run python -m mapping_memory.reindex
```

The reindex command requires `OPENAI_API_KEY` because it recreates embeddings. It embeds
all SQLite notes, recreates the Chroma collection, writes fresh chunks, and prints the
notes indexed, chunks indexed, and Chroma path. It does not delete SQLite data and is
safe to run multiple times.

Search notes across all notes, only Uncategorized, or one category:

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/search?q=CD-30954"
Invoke-RestMethod "http://127.0.0.1:8000/search?q=CD-30954&uncategorized=true"
Invoke-RestMethod "http://127.0.0.1:8000/search?q=CD-30954&category_id=1"
```

Search results include `match_type` (`exact`, `semantic`, or `hybrid`) and
`matched_snippet`, which is currently `null`.

Ask a grounded question across all notes, only Uncategorized, or one category:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" -Body '{"question":"What source recreation decision was saved?"}'
Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" -Body '{"question":"What source recreation decision was saved?","uncategorized":true}'
Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" -Body '{"question":"What source recreation decision was saved?","category_id":1}'
Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" -Body '{"question":"What source recreation decision was saved?","note_ids":[1,2,3]}'
Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" -Body '{"question":"What source recreation decision was saved?","history":[{"role":"user","content":"What did we discuss?"},{"role":"assistant","content":"We discussed source recreation."}]}'
```

Ask `history` is limited to 10 messages, each message must use role `user` or `assistant`,
and each non-blank content string is limited to 4,000 characters. Retrieval uses only the
last 6 history messages plus the current question, capped to 4,000 characters. History is
not used as answer source material; answers remain grounded only in retrieved saved notes.

## Test

```powershell
uv run python -m pytest
```
