# Note Memory Backend

## Setup

```powershell
uv sync --dev
```

The backend starts without `backend/.env` or provider keys. `GROQ_API_KEY` enables
note organization, grounded Ask, and Mem0 extraction with separate role settings:
Chat uses `openai/gpt-oss-120b` with high reasoning, while Utility uses
`openai/gpt-oss-20b` with medium reasoning. Validation and Web are reserved roles with
the same respective defaults. The Chat model is validated at startup against the
application's Groq local/remote tool-calling allowlist, so an unsupported Chat model
prevents startup rather than reporting Ask healthy. Role-specific `GROQ_*` settings
override the deprecated `GROQ_MODEL` and `GROQ_REASONING_EFFORT` fallbacks; the legacy
variables remain for one release and are removed in the next breaking configuration
release.

| Role | Model default | Reasoning default | Current owner |
| --- | --- | --- | --- |
| Chat | `openai/gpt-oss-120b` | `high` | Grounded Ask; validated for local/remote tool support. |
| Utility | `openai/gpt-oss-20b` | `medium` | Note organization and Mem0 extraction. |
| Validation | `openai/gpt-oss-20b` | `medium` | Reserved for validation work. |
| Web | `openai/gpt-oss-120b` | `high` | Reserved for web work. |
`VOYAGE_API_KEY` enables 1024-dimensional `voyage-4-large` document/query embeddings,
semantic search, and Ask-only `rerank-2.5` reranking. Learned Mem0 memory requires both
keys. Notes always save to SQLite and the Markdown vault; provider failures do not roll
back storage. Startup reconciles the vault into SQLite, then validates and, when needed,
rebuilds the derived Chroma note index.

> [!WARNING]
> **Privacy and work data.**
>
> Groq receives note text, Ask questions, and selected chat text for metadata,
> grounded answers, and memory extraction. Voyage receives note chunks and retrieval
> queries for embeddings, plus semantic Ask candidates for reranking. Do not store
> confidential or work-restricted material unless your policy permits sending it to
> both configured provider accounts.

Copy `.env.example` to `.env` only when you are ready to provide real keys. The
provider model names, dimensions, timeout, and retry settings in that template are
configurable. The four supported key states are:

| Keys | Available provider features |
| --- | --- |
| Neither | Fallback metadata and exact/fuzzy local search |
| Groq only | Organization and Ask over exact/fuzzy/selected-note evidence |
| Voyage only | Semantic indexing and sidebar search |
| Both | Full semantic Ask, reranking, and learned memory |

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
{
  "status": "ok",
  "capabilities": {
    "groq": true,
    "voyage": true,
    "organization": true,
    "semantic_search": true,
    "ask": true,
    "reranking": true,
    "memory": true
  }
}
```

Health checks inspect configuration and local fingerprints only; they make no live
provider requests.

Create a category:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/categories -Method Post -ContentType "application/json" -Body '{"name":"Work"}'
```

List categories:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/categories
```

Rename a category:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/categories/1 -Method Patch -ContentType "application/json" -Body '{"name":"Projects"}'
```

Delete a category and uncategorize its notes:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/categories/1 -Method Delete
```

Category deletion removes the SQLite category, clears that category from affected notes and their Markdown frontmatter, refreshes SQLite FTS, and attempts Chroma reindexing for each affected note. Reindex failures are logged and returned in `vector_cleanup` without restoring the deleted category.

Create a note:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/notes -Method Post -ContentType "application/json" -Body '{"original_text":"My note","category_id":1}'
```

The create body can also include `ai_title`, `short_summary`, and `tags` when the
browser saves those fields from YAML frontmatter directly. Missing or null
metadata fields are filled by the organizer on first save; supplied fields take
precedence, including `tags: []`. The organizer does not change the body or
category. If it is unavailable, local fallbacks are saved and the response sets
`needs_ai_organization` to `true`.

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
After a successful `/notes/organize` preview is applied, the browser sends the
write-only `"ai_organization_completed": true` field with the metadata update to
clear `needs_ai_organization` atomically. Ordinary updates preserve the marker.

Regenerate draft metadata without saving a note:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/notes/organize -Method Post -ContentType "application/json" -Body '{"original_text":"Draft note body"}'
```

The organize endpoint returns `ai_title`, `short_summary`, and `tags` for the supplied body text. It does not write SQLite data or update retrieval indexes.

Delete one note:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/notes/1 -Method Delete
```

Delete removes the SQLite note, refreshes SQLite FTS, and attempts Chroma chunk cleanup. Chroma cleanup failures are logged and returned in `vector_cleanup` without restoring the deleted note.

## Rebuild the Chroma index

Markdown files are reconciled into SQLite on startup, and SQLite then acts as
the source for Chroma. Chroma stores the derived retrieval index: embedded
chunks of saved notes plus metadata used by semantic search and Ask retrieval.

Chroma is rebuildable. Run the reindex command when the Chroma directory is
missing, has been deleted, looks stale, or semantic search / Ask retrieval
is not reflecting the notes saved in SQLite. Backend startup also compares
SQLite notes against Chroma chunk metadata and the provider fingerprint at
`CHROMA_PATH/index-provider.json`. Legacy or incompatible collections are recreated
immediately, including when no Voyage key is available. With `VOYAGE_API_KEY`, startup
rebuilds in document batches of at most 64 and writes the fingerprint only after full
success. A failed or partial rebuild remains unavailable and is retried next startup.

Run from `backend/`:

```powershell
uv run python -m mapping_memory.reindex
```

The reindex command requires `VOYAGE_API_KEY` because it recreates embeddings. It embeds
all SQLite notes, recreates the Chroma collection, writes fresh chunks, and prints the
notes indexed, chunks indexed, and Chroma path. It does not delete SQLite data and is
safe to run multiple times.

Search notes across all notes, only Uncategorized, or one category:

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/search?q=CD-30954"
Invoke-RestMethod "http://127.0.0.1:8000/search?q=CD-30954&uncategorized=true"
Invoke-RestMethod "http://127.0.0.1:8000/search?q=CD-30954&category_id=1"
Invoke-RestMethod "http://127.0.0.1:8000/search?q=CD-30954&semantic=false"
```

Search results include `match_type` (`exact`, `fuzzy`, `semantic`, or `hybrid`) and
`matched_snippet`. Exact matches include a compact plain-text snippet from the matched
note body or metadata. Fuzzy matches use local RapidFuzz matching over note titles and
tags. Semantic matches include a compact cleaned snippet from the best matching
retrieval chunk, and hybrid matches prefer local snippets when available. Pass
`semantic=false` to skip embeddings and Chroma for local-only search.

Ask a grounded question across all notes, only Uncategorized, one category, or
selected note IDs. Pass `thread_id` to store the turn in a specific durable chat
thread. Responses include cited sources with snippets from retrieved note evidence:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" -Body '{"question":"What source recreation decision was saved?"}'
Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" -Body '{"question":"What source recreation decision was saved?","uncategorized":true}'
Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" -Body '{"question":"What source recreation decision was saved?","category_id":1}'
Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" -Body '{"question":"What source recreation decision was saved?","note_ids":[1,2,3]}'
Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" -Body '{"thread_id":1,"question":"What source recreation decision was saved?","note_ids":[1,2,3]}'
Invoke-RestMethod http://127.0.0.1:8000/ask -Method Post -ContentType "application/json" -Body '{"question":"What source recreation decision was saved?","history":[{"role":"user","content":"What did we discuss?"},{"role":"assistant","content":"We discussed source recreation."}]}'
```

Ask `history` is limited to 10 messages, each message must use role `user` or `assistant`,
and each non-blank content string is limited to 4,000 characters. Retrieval uses only the
last 6 history messages plus the current question, capped to 4,000 characters. History is
not used as answer source material; answers remain grounded only in retrieved saved notes.

Successful answered and no-evidence turns are stored under the internal
`local-owner` ID. New chat threads start as `Untitled chat`; the first stored
question renames that title automatically. Each thread stores its own scope as
`{"mode":"all"}` or `{"mode":"custom","note_ids":[...]}`. Ask responses include
`memory_updates`, which is `0` when learning is disabled, nothing durable was
learned, or Mem0 is unavailable. Memories may adapt interpretation and presentation,
but saved notes remain the only evidence source.

Create, list, update, delete, and read chat threads. The legacy `/chat` endpoints
remain compatibility aliases for the most recently updated thread:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/chat/threads
Invoke-RestMethod http://127.0.0.1:8000/chat/threads -Method Post -ContentType "application/json" -Body '{}'
Invoke-RestMethod http://127.0.0.1:8000/chat/threads/1 -Method Patch -ContentType "application/json" -Body '{"title":"Launch questions","scope":{"mode":"custom","note_ids":[1,2]}}'
Invoke-RestMethod http://127.0.0.1:8000/chat/threads/1/messages
Invoke-RestMethod http://127.0.0.1:8000/chat/threads/1 -Method Delete
Invoke-RestMethod http://127.0.0.1:8000/chat
Invoke-RestMethod http://127.0.0.1:8000/chat -Method Delete
```

List or manage learned memories separately from chat threads:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/memories
Invoke-RestMethod http://127.0.0.1:8000/memories/MEMORY_ID -Method Patch -ContentType "application/json" -Body '{"content":"Prefers concise Markdown answers."}'
Invoke-RestMethod http://127.0.0.1:8000/memories/MEMORY_ID -Method Delete
Invoke-RestMethod http://127.0.0.1:8000/memories -Method Delete
Invoke-RestMethod http://127.0.0.1:8000/memory-settings
Invoke-RestMethod http://127.0.0.1:8000/memory-settings -Method Patch -ContentType "application/json" -Body '{"learning_enabled":false}'
```

Mem0 uses `MEMORY_PATH` (default `../data/memory`) for the dedicated
`user_memories` Chroma collection and history database. Do not delete it when rebuilding
the note index. Its provider fingerprint is `MEMORY_PATH/memory-provider.json`.
Incompatible memory is preserved while either key is missing; with both keys it is
deleted and initialized as a fresh Groq/Voyage store. Existing memories are not backed
up or migrated. Embedded storage is for the current single-process local deployment.

## Test

```powershell
uv run python -m pytest
```

The live Groq/Voyage Mem0 CRUD and persistence compatibility check is opt-in and
requires both provider keys:

```powershell
$env:RUN_MEM0_INTEGRATION_TESTS = "1"
uv run python -m pytest tests/test_memory.py -k live
```

Extraction-policy cases are separately opt-in because they make several live model calls:

```powershell
$env:RUN_MEM0_POLICY_TESTS = "1"
uv run python -m pytest tests/test_memory.py -k extraction_policy
```
