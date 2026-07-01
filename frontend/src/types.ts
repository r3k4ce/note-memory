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
};

export type CategoryCreate = {
  name: string;
};

export type NoteCreate = {
  original_text: string;
  category_id?: number | null;
};

export type NoteMetadataUpdate = {
  ai_title: string;
  short_summary: string;
  tags: string[];
  category_id?: number | null;
};

export type AskRequest = {
  question: string;
};

export type AskSource = {
  note_id: number;
  title: string;
  date_added: string;
};

export type AskResponse = {
  answer: string;
  sources: AskSource[];
};
