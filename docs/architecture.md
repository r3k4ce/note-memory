# Architecture

Mapping Memory is a FastAPI backend with a React TypeScript frontend. Feature modules own their state and request lifecycles; `App` and `main` are the composition boundaries.

## Frontend ownership

- [`features/layout`](../frontend/src/features/layout) owns pane sizing, resize/focus behavior, layout refs, and resize handles through `useWorkspaceLayout` and `PaneResizeHandle`.
- [`features/ask`](../frontend/src/features/ask) owns Ask threads, messages, pending requests, and per-thread note scope in `useAskController`; `AskChat` is the controlled Bun pane view.
- [`features/notebook`](../frontend/src/features/notebook) owns notebook and search behavior. `useNotebookController` manages notes/categories, selection, editing, filters, and drag/drop. `useSearchController` manages query timing, request invalidation, results, and result reconciliation. `NotesSidebar`, `BrowseTree`, `SearchResults`, and `CategoryManager` render controlled views; `NotesSidebar` owns the settings-dialog open state and footer trigger.
- [`components`](../frontend/src/components) owns the shared note workspace, editor/read surfaces, toolbar, reusable presentation components, and the central `SettingsDialog` with its Appearance and Memory sections.
- [`App.tsx`](../frontend/src/App.tsx) composes the feature controllers and views, keyboard shortcuts, and the few cross-feature flows below. Feature-specific HTTP work stays in the controllers.

## Cross-feature flows

- **Ask citation navigation:** a source selection reaches `App.handleAskSourceSelect`, which first calls `notebook.canOpenSourceNote()` to confirm any dirty-edit discard. Accepted navigation then calls `search.clear()` followed by `notebook.openSourceNote(noteId)`, so cancellation preserves search state while acceptance clears stale results before selecting the cited note and its category.
- **Search reconciliation:** `App` passes `useSearchController` callbacks (`replaceNote`, `deleteNotes`, `renameCategory`, and `uncategorizeNotes`) into `useNotebookController`. Successful note/category mutations update active result cards without rerunning the query, while search match metadata remains intact.
- **Ask scope:** `useAskController` is the source of truth for all/custom note scope. It loads and persists scope per chat thread and normalizes it against the notebook's available note IDs. `BrowseTree`, `SearchResults`, and `CategoryManager` receive controlled scope values and callbacks through `App`, so browsing or searching does not create a second scope state.

## Backend boundaries

- [`main.py`](../backend/src/mapping_memory/main.py) assembles settings, memory, middleware, routers, health capabilities, and application lifespan. Startup initializes SQLite, synchronizes the Markdown vault, reconciles Chroma with SQLite/provider fingerprints, then best-effort initializes memory.
- [`notes_api.py`](../backend/src/mapping_memory/notes_api.py) and [`categories_api.py`](../backend/src/mapping_memory/categories_api.py) own HTTP validation, status/error mapping, AI organization orchestration, and best-effort retrieval-index updates. Other endpoint families remain in their own Ask, memory, and search routers.
- [`notes.py`](../backend/src/mapping_memory/notes.py) owns SQLite note/category CRUD, FTS maintenance, and Markdown mirror writes. [`vault_sync.py`](../backend/src/mapping_memory/vault_sync.py) owns startup reconciliation from Markdown file deletion, addition, and newer file content back into SQLite.
- [`ai.py`](../backend/src/mapping_memory/ai.py) preserves application-facing organizer/grounded-answer contracts and prompts; [`groq_ai.py`](../backend/src/mapping_memory/groq_ai.py) owns Groq construction, strict structured output, and sanitized provider failures.
- [`voyage_embeddings.py`](../backend/src/mapping_memory/voyage_embeddings.py) owns native Voyage document/query embeddings. [`voyage_reranker.py`](../backend/src/mapping_memory/voyage_reranker.py) reranks only semantic Ask candidates. [`provider_fingerprint.py`](../backend/src/mapping_memory/provider_fingerprint.py) owns narrow Chroma and Mem0 compatibility records.
- [`exact_search.py`](../backend/src/mapping_memory/exact_search.py) owns scoped FTS candidate lookup plus literal-match filtering and snippets. [`retrieval_index.py`](../backend/src/mapping_memory/retrieval_index.py) owns note chunking, document embedding, and per-note/full Chroma lifecycle operations.
- [`search.py`](../backend/src/mapping_memory/search.py) owns the `/search` router and merges exact, fuzzy, and optional semantic results without reranking. [`rag.py`](../backend/src/mapping_memory/rag.py) builds scoped Ask retrieval context from exact, reranked semantic, fuzzy, and selected-note rescue candidates; Ask answer generation and citation validation remain in the Ask/AI boundary.
- [`memory.py`](../backend/src/mapping_memory/memory.py) preserves the Mem0 application adapter while configuring native Groq plus the LangChain Voyage embedding bridge. Memory is ready only with both provider keys and a compatible initialized store.

## Tests

- Focused frontend feature tests are colocated under [`frontend/src/features`](../frontend/src/features).
- Frontend shell and integration contracts live in [`frontend/src/App.test.tsx`](../frontend/src/App.test.tsx).
- Browser layout coverage lives in [`frontend/e2e`](../frontend/e2e).
- Backend unit and API coverage lives in [`backend/tests`](../backend/tests).
