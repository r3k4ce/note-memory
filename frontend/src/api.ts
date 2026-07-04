import type {
  AskRequest,
  AskResponse,
  Category,
  CategoryCreate,
  CategoryDeleteResponse,
  CategoryScopeRequest,
  CategoryUpdate,
  Note,
  NoteCreate,
  NoteUpdate,
  SearchResult,
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

export function searchNotes(query: string, scope: CategoryScopeRequest = {}): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  appendCategoryScope(params, scope);

  return requestJson<SearchResult[]>(`/search?${params.toString()}`);
}

export function getNote(noteId: number): Promise<Note> {
  return requestJson<Note>(`/notes/${noteId}`);
}

export function createNote(originalText: string, categoryId: number | null): Promise<Note> {
  const body: NoteCreate = { original_text: originalText, category_id: categoryId };

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
