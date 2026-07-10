import type {
  AskRequest,
  AskResponse,
  Category,
  CategoryCreate,
  CategoryDeleteResponse,
  CategoryScopeRequest,
  CategoryUpdate,
  ChatThread,
  ChatThreadUpdate,
  Note,
  NoteCreate,
  NoteUpdate,
  OrganizedNoteMetadata,
  SearchResult,
  MemoryRecord,
  MemorySettings,
  StoredChatMessage,
} from "./types";

export const BACKEND_BASE_URL =
  import.meta.env.VITE_BACKEND_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

type ApiErrorBody = {
  detail?: unknown;
};

function formatDetail(detail: unknown): string | null {
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object" && "msg" in item && typeof item.msg === "string") {
          return item.msg;
        }

        return null;
      })
      .filter((message): message is string => message !== null)
      .join(" ");
  }

  return null;
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    const detail = formatDetail(body.detail);
    return detail || fallback;
  } catch {
    return fallback;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BACKEND_BASE_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
      ...init,
    });
  } catch {
    throw new Error("Could not reach the backend. Confirm it is running at the configured URL.");
  }

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `Request failed with status ${response.status}.`));
  }

  return (await response.json()) as T;
}

export function listCategories(): Promise<Category[]> {
  return requestJson<Category[]>("/categories");
}

export function createCategory(name: string): Promise<Category> {
  const body: CategoryCreate = { name };

  return requestJson<Category>("/categories", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateCategory(categoryId: number, name: string): Promise<Category> {
  const body: CategoryUpdate = { name };

  return requestJson<Category>(`/categories/${categoryId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteCategory(categoryId: number): Promise<CategoryDeleteResponse> {
  return requestJson<CategoryDeleteResponse>(`/categories/${categoryId}`, {
    method: "DELETE",
  });
}

export function listNotes(categoryId?: number): Promise<Note[]> {
  const path = categoryId === undefined ? "/notes" : `/notes?category_id=${categoryId}`;
  return requestJson<Note[]>(path);
}

function appendCategoryScope(params: URLSearchParams, scope: CategoryScopeRequest): void {
  if (scope.category_id !== undefined) {
    params.set("category_id", String(scope.category_id));
  }

  if (scope.uncategorized === true) {
    params.set("uncategorized", "true");
  }
}

type SearchRequestOptions = CategoryScopeRequest & {
  semantic?: boolean;
};

export function searchNotes(query: string, options: SearchRequestOptions = {}): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  appendCategoryScope(params, options);
  if (options.semantic !== undefined) {
    params.set("semantic", String(options.semantic));
  }

  return requestJson<SearchResult[]>(`/search?${params.toString()}`);
}

export function getNote(noteId: number): Promise<Note> {
  return requestJson<Note>(`/notes/${noteId}`);
}

export function createNote(body: NoteCreate): Promise<Note> {
  return requestJson<Note>("/notes", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateNote(noteId: number, body: NoteUpdate): Promise<Note> {
  return requestJson<Note>(`/notes/${noteId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function organizeNote(originalText: string): Promise<OrganizedNoteMetadata> {
  const body: NoteCreate = { original_text: originalText };

  return requestJson<OrganizedNoteMetadata>("/notes/organize", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteNote(noteId: number): Promise<void> {
  await requestJson<unknown>(`/notes/${noteId}`, {
    method: "DELETE",
  });
}

export function askQuestion(request: AskRequest): Promise<AskResponse> {
  return requestJson<AskResponse>("/ask", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function getChat(): Promise<StoredChatMessage[]> {
  return requestJson<StoredChatMessage[]>("/chat");
}

export function listChatThreads(): Promise<ChatThread[]> {
  return requestJson<ChatThread[]>("/chat/threads");
}

export function createChatThread(): Promise<ChatThread> {
  return requestJson<ChatThread>("/chat/threads", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function updateChatThread(threadId: number, body: ChatThreadUpdate): Promise<ChatThread> {
  return requestJson<ChatThread>(`/chat/threads/${threadId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteChatThread(threadId: number): Promise<void> {
  return requestEmpty(`/chat/threads/${threadId}`, "DELETE");
}

export function getChatThreadMessages(threadId: number): Promise<StoredChatMessage[]> {
  return requestJson<StoredChatMessage[]>(`/chat/threads/${threadId}/messages`);
}

async function requestEmpty(path: string, method: "DELETE"): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_BASE_URL}${path}`, { method });
  } catch {
    throw new Error("Could not reach the backend. Confirm it is running at the configured URL.");
  }
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response, `Request failed with status ${response.status}.`));
  }
}

export function clearChat(): Promise<void> {
  return requestEmpty("/chat", "DELETE");
}

export function listMemories(): Promise<MemoryRecord[]> {
  return requestJson<MemoryRecord[]>("/memories");
}

export function updateMemory(memoryId: string, content: string): Promise<MemoryRecord> {
  return requestJson<MemoryRecord>(`/memories/${encodeURIComponent(memoryId)}`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });
}

export function deleteMemory(memoryId: string): Promise<void> {
  return requestEmpty(`/memories/${encodeURIComponent(memoryId)}`, "DELETE");
}

export function deleteAllMemories(): Promise<void> {
  return requestEmpty("/memories", "DELETE");
}

export function getMemorySettings(): Promise<MemorySettings> {
  return requestJson<MemorySettings>("/memory-settings");
}

export function updateMemorySettings(learningEnabled: boolean): Promise<MemorySettings> {
  return requestJson<MemorySettings>("/memory-settings", {
    method: "PATCH",
    body: JSON.stringify({ learning_enabled: learningEnabled }),
  });
}
