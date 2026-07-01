export type Note = {
  id: number;
  original_text: string;
  ai_title: string;
  short_summary: string;
  tags: string[];
  date_added: string;
  updated_at: string;
};

export type NoteCardData = Pick<Note, "id" | "ai_title" | "short_summary" | "tags" | "date_added">;

export type SearchResult = NoteCardData & {
  score: number;
};

export type NoteCreate = {
  original_text: string;
};

export type NoteMetadataUpdate = {
  ai_title: string;
  short_summary: string;
  tags: string[];
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
