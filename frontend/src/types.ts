export type Category = {
  id: number;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
};

export type Note = {
  id: number;
  original_text: string;
  ai_title: string;
  short_summary: string;
  tags: string[];
  date_added: string;
  updated_at: string;
  category: Category | null;
};

export type NoteCardData = Pick<
  Note,
  "id" | "ai_title" | "short_summary" | "tags" | "date_added" | "category"
>;

export type SearchResult = NoteCardData & {
  score: number;
  match_type: "exact" | "semantic" | "hybrid" | "fuzzy";
  matched_snippet: string | null;
};

export type CategoryCreate = {
  name: string;
};

export type CategoryUpdate = {
  name: string;
};

export type CategoryDeleteResponse = {
  id: number;
  deleted: boolean;
  deleted_note_ids: number[];
  uncategorized_note_ids: number[];
  vector_cleanup: "deleted" | "failed";
};

export type NoteCreate = {
  original_text: string;
  ai_title?: string;
  short_summary?: string;
  tags?: string[];
  category_id?: number | null;
};

export type NoteUpdate = {
  original_text?: string;
  ai_title?: string;
  short_summary?: string;
  tags?: string[];
  category_id?: number | null;
};

export type OrganizedNoteMetadata = {
  ai_title: string;
  short_summary: string;
  tags: string[];
};

export type CategoryScopeRequest = {
  category_id?: number;
  uncategorized?: boolean;
};

export type AskNoteScope =
  | { mode: "all" }
  | { mode: "custom"; noteIds: number[] };

export type AskHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AskRequest = CategoryScopeRequest & {
  question: string;
  note_ids?: number[];
  history?: AskHistoryMessage[];
};

export type AskSource = {
  note_id: number;
  title: string;
  date_added: string;
  snippets: AskSourceSnippet[];
};

export type AskSourceSnippet = {
  text: string;
  match_type: "semantic" | "exact" | "fuzzy" | "selected";
  chunk_index: number | null;
  chunk_type?: "full" | "summary" | "content";
  source_start?: number | null;
  source_end?: number | null;
};

export type AskEvidenceSummary = {
  source_count: number;
  snippet_count: number;
  match_types: AskSourceSnippet["match_type"][];
};

export type AskResponse = {
  answer: string;
  status: "answered" | "no_evidence";
  evidence_summary: AskEvidenceSummary;
  sources: AskSource[];
};

export type ChatMessage =
  | {
      id: string;
      role: "user";
      content: string;
    }
  | {
      id: string;
      role: "assistant";
      content: string;
      status?: AskResponse["status"];
      evidenceSummary?: AskEvidenceSummary;
      sources: AskSource[];
    }
  | {
      id: string;
      role: "error";
      content: string;
    };
