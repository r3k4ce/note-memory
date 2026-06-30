# Mapping Memory Backend

## Setup

```powershell
uv sync --dev
```

The backend starts without `backend/.env` and without `OPENAI_API_KEY`.

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

## Test

```powershell
uv run pytest
```
