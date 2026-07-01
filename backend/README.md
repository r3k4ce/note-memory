# Mapping Memory Backend

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

Create a note:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/notes -Method Post -ContentType "application/json" -Body '{"original_text":"My mapping note"}'
```

List notes:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/notes
```

Get one note:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/notes/1
```

Update note metadata:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/notes/1 -Method Patch -ContentType "application/json" -Body '{"ai_title":"Corrected title","short_summary":"Corrected summary.","tags":["routing","labels"]}'
```

Metadata updates refresh SQLite FTS and attempt Chroma reindexing. Chroma reindex failures are logged and do not roll back the saved metadata.

Delete one note:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/notes/1 -Method Delete
```

Delete removes the SQLite note, refreshes SQLite FTS, and attempts Chroma chunk cleanup. Chroma cleanup failures are logged and returned in `vector_cleanup` without restoring the deleted note.

Search notes:

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/search?q=CD-30954"
```

Ask a grounded question:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" -Body '{"question":"What source recreation decision was saved?"}'
```

## Test

```powershell
uv run python -m pytest
```
