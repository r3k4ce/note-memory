# Mapping Memory Backend

## Setup

```powershell
uv sync --dev
```

The backend starts without `backend/.env` and without `OPENAI_API_KEY`. When `OPENAI_API_KEY` is configured, note creation attempts AI metadata and falls back to local metadata if AI is unavailable. Embeddings use `OPENAI_EMBEDDING_MODEL`, defaulting to `text-embedding-3-small`. The local Chroma vector store uses `CHROMA_PATH`, defaulting to `../data/chroma`, and remains rebuildable rather than canonical storage.

## Run

```powershell
uv run uvicorn mapping_memory.main:app --reload
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

## Test

```powershell
uv run pytest
```
