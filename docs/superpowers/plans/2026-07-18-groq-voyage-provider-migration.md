# Groq and Voyage Provider Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all runtime OpenAI use with Groq for structured generation and Voyage for embeddings/reranking, while preserving local fallbacks and safely rebuilding provider-incompatible derived stores.

**Architecture:** Keep `ai.py` as the stable application boundary and delegate provider calls to focused Groq and Voyage modules. Treat the note Chroma collection and Mem0 directory as provider-fingerprinted derived stores whose readiness is established during startup and reported through additive health capabilities.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, Groq Python SDK, Voyage Python SDK, `langchain-voyageai`, Mem0 2.0.11, ChromaDB, pytest.

## Global Constraints

- Preserve prompts, Pydantic response models, API contracts, SQLite, Markdown, Chroma collection behavior, citation validation, source scoping, chat persistence, and frontend behavior.
- Default Groq configuration: `openai/gpt-oss-120b`, reasoning effort `medium`, timeout 60 seconds, one retry.
- Default Voyage configuration: `voyage-4-large`, 1024 dimensions, `rerank-2.5`, timeout 30 seconds, one retry.
- Document embeddings use `input_type="document"`; search and Ask query embeddings use `input_type="query"`.
- Document batches contain at most 64 texts; final Ask context remains 8 chunks with at most 2 chunks per note and 20 initial semantic candidates.
- Do not add authentication, multi-user behavior, database schema changes, provider registries, streaming, frontend work, retrieval tuning, or OpenAI compatibility fallbacks.
- Do not stage or commit; repository instructions override commit steps from the generic execution skill.

---

### Task 1: Provider settings and Groq structured generation

**Files:**
- Modify: `backend/src/mapping_memory/settings.py`
- Modify: `backend/src/mapping_memory/ai.py`
- Create: `backend/src/mapping_memory/groq_ai.py`
- Modify: `backend/tests/test_ai.py`
- Create: `backend/tests/test_groq_ai.py`

**Interfaces:**
- Consumes: `Settings`, `OrganizerMetadata`, `GroundedAnswer`, existing prompt strings.
- Produces: `create_groq_client(settings)`, `request_structured_output(messages, response_model, settings, client=None)`, unchanged `organize_mapping_text(...)` and `generate_grounded_answer(...)` contracts.

- [ ] Add failing tests for the Groq key/model/reasoning/timeout/retry settings, strict JSON-schema request body, organizer and grounded-answer parsing, missing/blank/malformed output, Pydantic validation, and generic provider-failure translation.
- [ ] Run `uv run pytest tests/test_ai.py tests/test_groq_ai.py -q` and confirm failures are caused by missing Groq settings/module behavior.
- [ ] Move only Groq client construction and structured request parsing into `groq_ai.py`; construct `Groq(api_key=..., timeout=..., max_retries=...)`, request `response_format={"type": "json_schema", "json_schema": {"name": ..., "strict": True, "schema": model.model_json_schema()}}`, set `reasoning_effort`, parse `message.content` with `model_validate_json`, and expose only application-level errors.
- [ ] Keep models/prompts/application functions in `ai.py`, strengthen claim validators for blank text and invalid evidence-ID lists, and preserve existing fallback/exception semantics.
- [ ] Re-run the focused tests and confirm they pass without live calls.

### Task 2: Voyage document/query embeddings and reranking

**Files:**
- Modify: `backend/src/mapping_memory/embeddings.py`
- Create: `backend/src/mapping_memory/voyage_embeddings.py`
- Create: `backend/src/mapping_memory/voyage_reranker.py`
- Modify: `backend/tests/test_embeddings.py`
- Create: `backend/tests/test_voyage_reranker.py`

**Interfaces:**
- Produces: `embed_documents(texts, *, settings=None, client=None) -> list[list[float]]`, `embed_query(text, *, settings=None, client=None) -> list[float]`, compatibility `embed_texts(...)`, and `rerank_chunks(query, candidates, *, settings=None, client=None) -> list[VectorSearchResult]`.
- Invariants: input order and candidate metadata are preserved; every vector length equals `voyage_embedding_dimensions`; provider details never escape application exceptions.

- [ ] Add failing tests for blank/empty validation, `document` versus `query` input types, 64-item batching, multi-batch order, configured model/dimension, dimension mismatch, client timeout/retries, provider translation, reranked indices, full chunk documents, and metadata preservation.
- [ ] Run `uv run pytest tests/test_embeddings.py tests/test_voyage_reranker.py -q` and verify expected failures.
- [ ] Implement the Voyage client boundary with `voyageai.Client(api_key=..., timeout=..., max_retries=...)`, `output_dimension=1024`, batch slicing at 64, and validation before returning vectors.
- [ ] Implement reranking with `client.rerank(query, [candidate.text...], model=..., top_k=len(candidates))`; validate returned indices and return candidates in ranked order.
- [ ] Re-run focused tests and confirm pass.

### Task 3: Chroma provider fingerprint and all-or-nothing rebuild readiness

**Files:**
- Create: `backend/src/mapping_memory/provider_fingerprint.py`
- Modify: `backend/src/mapping_memory/reindex.py`
- Modify: `backend/src/mapping_memory/retrieval_index.py`
- Modify: `backend/src/mapping_memory/vector_store.py`
- Modify: `backend/tests/test_reindex.py`
- Modify: `backend/tests/test_retrieval_index.py`
- Modify: `backend/tests/test_app_lifecycle.py`

**Interfaces:**
- Produces: `expected_chroma_fingerprint(settings)`, `read_fingerprint(path)`, `write_fingerprint(path, value)`, `remove_fingerprint(path)`, and `chroma_index_ready(settings) -> bool`.
- Fingerprint path: `settings.chroma_path / "index-provider.json"`; fields are provider, model, dimensions, input-format version, and chunk-format version.

- [ ] Add failing lifecycle tests for compatible, missing, mismatched provider/model/dimension/input-version/chunk-version fingerprints; invalid legacy collection deletion without Voyage; success-only fingerprint writes; failed/partial rebuild readiness; and retry on next startup.
- [ ] Run the three focused lifecycle test modules and verify failures reflect missing fingerprint behavior.
- [ ] Add narrow JSON fingerprint helpers using atomic same-directory temporary-file replacement and no generic migration framework.
- [ ] Change reconciliation to inspect collection metadata plus the fingerprint, immediately recreate/remove stale fingerprint when incompatible, rebuild synchronously only with Voyage, and swallow/log startup failures while leaving readiness false.
- [ ] Change full rebuild to use `embed_documents` in batches, recreate before adding, stop on any failed batch, and write the fingerprint only after every batch succeeds; note indexing/reindexing also use `embed_documents` and do nothing when semantic storage is not ready.
- [ ] Re-run lifecycle tests and existing vector/index tests.

### Task 4: Search and Ask semantic reranking flow

**Files:**
- Modify: `backend/src/mapping_memory/search.py`
- Modify: `backend/src/mapping_memory/rag.py`
- Modify: `backend/src/mapping_memory/ask.py`
- Modify: `backend/tests/test_search_api.py`
- Modify: `backend/tests/test_rag.py`
- Modify: `backend/tests/test_ask_api.py`

**Interfaces:**
- Search uses `embed_query(query)` only when the Chroma fingerprint is ready and never invokes reranking.
- Ask builds one history-aware retrieval query, embeds it as a query, gets 20 semantic candidates, attempts `rerank_chunks`, then applies current final/per-note limits before fuzzy and selected-note rescue logic.

- [ ] Add failing tests that assert search/Ask query embedding use, history-aware query reranking, full semantic candidate text, exact-first ordering, reranker-failure Chroma order, no sidebar reranking, local fallbacks after semantic failure, and Groq-only Ask from exact/fuzzy/selected evidence.
- [ ] Run the focused search/RAG/Ask modules and verify failures.
- [ ] Update semantic paths to check readiness, call `embed_query`, and catch semantic/reranker failures locally so fuzzy and selected-note fallbacks always execute.
- [ ] Log reranker failures without provider detail and preserve original hit order.
- [ ] Preserve the existing sanitized Ask 503 when evidence exists but Groq is unavailable, exact no-evidence response when no evidence exists, citation validator, and chat-turn persistence.
- [ ] Re-run focused tests and confirm the existing limits and API schemas remain unchanged.

### Task 5: Mem0 Groq/Voyage migration and memory fingerprint lifecycle

**Files:**
- Modify: `backend/src/mapping_memory/memory.py`
- Modify: `backend/src/mapping_memory/main.py`
- Modify: `backend/tests/test_memory.py`

**Interfaces:**
- `MemoryAdapter` retains `search`, `learn`, `list`, `update`, `delete`, and `delete_all`.
- Adds `initialize() -> bool` and readiness-backed `available`; fingerprint path is `settings.memory_path / "memory-provider.json"`.

- [ ] Add failing tests for the four provider-key states, compatible fingerprint preservation, incompatible store preservation with a missing key, incompatible store deletion with both keys, no backup, success-only fingerprint writing, initialization failure, and best-effort Ask behavior.
- [ ] Run `uv run pytest tests/test_memory.py tests/test_ask_api.py -q` and verify failures.
- [ ] Build `VoyageAIEmbeddings(model=..., voyage_api_key=..., output_dimension=...)` only inside the Mem0 boundary and pass it as the LangChain embedder model; configure Mem0 native `groq` LLM with model/API key/reasoning effort and existing Chroma/history/custom instructions.
- [ ] Initialize memory during startup after the note index; on an incompatible store, remove only `settings.memory_path` when both keys exist, recreate it, initialize Mem0, and atomically write the memory fingerprint after success.
- [ ] Keep every memory operation best-effort for Ask and preserve existing memory API semantics.
- [ ] Re-run focused memory and Ask tests.

### Task 6: Additive capabilities and dependency/configuration cleanup

**Files:**
- Modify: `backend/src/mapping_memory/main.py`
- Modify: `backend/tests/test_health.py`
- Modify: `backend/tests/test_package.py`
- Modify: `backend/pyproject.toml`
- Modify: `backend/uv.lock`
- Modify: `backend/.env.example`

**Interfaces:**
- `/health` returns `{"status": "ok", "capabilities": {...}}` without network calls.
- Capability values follow configuration plus local `chroma_index_ready`/`MemoryAdapter.available` readiness.

- [ ] Add failing matrix tests for neither key, Groq only, Voyage only with ready/unready Chroma, and both keys with ready/unready memory.
- [ ] Run `uv run pytest tests/test_health.py tests/test_package.py -q` and verify failures.
- [ ] Add the seven configured/readiness-derived capability values while preserving `status: "ok"`.
- [ ] Replace `openai` with `groq`, `voyageai`, and `langchain-voyageai` in `pyproject.toml`; update the lock with `uv lock`/`uv sync --dev`; replace active OpenAI environment variables with the specified Groq/Voyage variables.
- [ ] Re-run focused health/package tests and scan active runtime/configuration with `rg -n "openai|OPENAI" backend/src backend/.env.example backend/pyproject.toml README.md backend/README.md`.

### Task 7: Documentation, regression coverage, and final verification

**Files:**
- Modify: `README.md`
- Modify: `backend/README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/project-memory.yaml`
- Modify: relevant `backend/tests/` regression modules

**Interfaces:**
- Documentation describes the four capability states, provider data egress, defaults, fingerprints/reset behavior, and local-only startup without exposing secrets.

- [ ] Replace active OpenAI setup/runtime documentation with Groq/Voyage configuration, local-only behavior, Chroma/Mem0 reset rules, and optional live-test instructions using separate markers and temporary data.
- [ ] Add/adjust regressions for note persistence after either provider fails, exact/fuzzy fallback, Groq-only Ask, Voyage-only semantic search, unchanged no-evidence/citation/chat schemas, and absence of OpenAI runtime imports/settings.
- [ ] Run focused modified backend tests, then `uv run ruff format .` only to mechanically format changed Python.
- [ ] Run `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright`, and `uv run pytest` from `backend/`.
- [ ] Run `./scripts/check.sh` from the repository root and record any skipped live provider checks because no real keys are required or used.
- [ ] Update `docs/project-memory.yaml` with one compact completed-implementation entry containing UTC/local time, scope, and exact verification results.
- [ ] Review `git diff --check`, `git status --short`, and the approved specification acceptance criteria before handoff.
