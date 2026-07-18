import type { Category, Note, NoteCreate, NoteUpdate, OrganizedNoteMetadata } from "../types";

type ParsedFrontmatter = {
  body: string;
  fields: Record<string, string>;
  hasFrontmatter: boolean;
};

export type ParsedNoteEditorDocument = {
  update: Required<Pick<NoteUpdate, "original_text" | "ai_title" | "short_summary" | "tags" | "category_id">>;
  categoryNameToCreate: string | null;
};

export type ParsedDraftNoteEditorDocument = {
  update: NoteCreate & { original_text: string; category_id: number | null };
  categoryNameToCreate: string | null;
};

function trimOneLeadingNewline(value: string): string {
  return value.startsWith("\r\n") ? value.slice(2) : value.startsWith("\n") ? value.slice(1) : value;
}

function parseFrontmatter(value: string): ParsedFrontmatter {
  const normalizedValue = value.replace(/\r\n/g, "\n");
  if (!normalizedValue.startsWith("---\n")) {
    return { body: value, fields: {}, hasFrontmatter: false };
  }

  const closingMarkerIndex = normalizedValue.indexOf("\n---", 4);
  if (closingMarkerIndex === -1) {
    return { body: value, fields: {}, hasFrontmatter: false };
  }

  const closingMarkerEnd = normalizedValue.indexOf("\n", closingMarkerIndex + 1);
  const bodyStart = closingMarkerEnd === -1 ? normalizedValue.length : closingMarkerEnd + 1;
  const frontmatterText = normalizedValue.slice(4, closingMarkerIndex);
  const fields: Record<string, string> = {};

  for (const line of frontmatterText.split("\n")) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    if (!key) {
      continue;
    }

    fields[key] = line.slice(separatorIndex + 1).trim();
  }

  return {
    body: trimOneLeadingNewline(normalizedValue.slice(bodyStart)),
    fields,
    hasFrontmatter: true,
  };
}

function normalizeTags(tagsText: string): string[] {
  const tags: string[] = [];
  const seenTags = new Set<string>();

  for (const tag of tagsText.split(",")) {
    const normalizedTag = tag.trim().toLowerCase();
    if (!normalizedTag || seenTags.has(normalizedTag)) {
      continue;
    }

    tags.push(normalizedTag);
    seenTags.add(normalizedTag);
  }

  return tags;
}

function findCategoryIdByName(categories: Category[], categoryName: string): number | null {
  const normalizedName = categoryName.trim().toLowerCase();
  const category = categories.find((candidate) => candidate.name.toLowerCase() === normalizedName);

  return category?.id ?? null;
}

export function serializeNoteEditorDocument(note: Note): string {
  return [
    "---",
    `title: ${note.ai_title}`,
    `summary: ${note.short_summary}`,
    `tags: ${note.tags.join(", ")}`,
    `category: ${note.category?.name ?? ""}`,
    "---",
    "",
    note.original_text,
  ].join("\n");
}

export function createBlankNoteEditorDocument(categoryName = ""): string {
  return ["---", "title: ", "summary: ", "tags: ", `category: ${categoryName}`, "---", ""].join("\n");
}

export function parseDraftNoteEditorDocument(
  value: string,
  categories: Category[],
): ParsedDraftNoteEditorDocument {
  const parsed = parseFrontmatter(value);
  const body = parsed.hasFrontmatter ? parsed.body : value;
  const categoryName = parsed.fields.category?.trim() ?? "";
  const categoryId = categoryName ? findCategoryIdByName(categories, categoryName) : null;
  const update: ParsedDraftNoteEditorDocument["update"] = {
    original_text: body,
    category_id: categoryId,
  };
  if (parsed.fields.title) {
    update.ai_title = parsed.fields.title;
  }
  if (parsed.fields.summary) {
    update.short_summary = parsed.fields.summary;
  }
  if (parsed.fields.tags) {
    update.tags = normalizeTags(parsed.fields.tags);
  }

  return {
    update,
    categoryNameToCreate: categoryName && categoryId === null ? categoryName : null,
  };
}

export function parseNoteEditorDocument(
  value: string,
  note: Note,
  categories: Category[],
): ParsedNoteEditorDocument {
  const parsed = parseFrontmatter(value);
  const previousCategoryId = note.category?.id ?? null;

  if (!parsed.hasFrontmatter) {
    return {
      update: {
        original_text: value,
        ai_title: note.ai_title,
        short_summary: note.short_summary,
        tags: note.tags,
        category_id: previousCategoryId,
      },
      categoryNameToCreate: null,
    };
  }

  const title = parsed.fields.title || note.ai_title;
  const summary = parsed.fields.summary || note.short_summary;
  const tags = "tags" in parsed.fields ? normalizeTags(parsed.fields.tags) : note.tags;
  const categoryName = parsed.fields.category?.trim() ?? note.category?.name ?? "";
  const categoryId = categoryName ? findCategoryIdByName(categories, categoryName) : null;

  return {
    update: {
      original_text: parsed.body,
      ai_title: title,
      short_summary: summary,
      tags,
      category_id: categoryId,
    },
    categoryNameToCreate: categoryName && categoryId === null ? categoryName : null,
  };
}

export function getNoteEditorBody(value: string): string {
  return parseFrontmatter(value).body;
}

export function updateNoteEditorDocumentMetadata(
  value: string,
  note: Note,
  metadata: OrganizedNoteMetadata,
): string {
  const parsed = parseFrontmatter(value);
  const body = parsed.hasFrontmatter ? parsed.body : value;
  const categoryName = parsed.fields.category ?? note.category?.name ?? "";

  return [
    "---",
    `title: ${metadata.ai_title}`,
    `summary: ${metadata.short_summary}`,
    `tags: ${metadata.tags.join(", ")}`,
    `category: ${categoryName}`,
    "---",
    "",
    body,
  ].join("\n");
}
