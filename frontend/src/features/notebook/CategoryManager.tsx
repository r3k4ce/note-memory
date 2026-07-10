import { Check, ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";
import type { FormEvent } from "react";

import type { Category, Note } from "../../types";

const SIDEBAR_ACCENT_BUTTON_CLASS =
  "inline-flex items-center justify-center bg-accent text-black transition-colors hover:bg-accent-hover disabled:opacity-40";
const SIDEBAR_ACCENT_ICON_BUTTON_CLASS =
  "rounded p-1.5 text-accent transition-colors hover:bg-surface-hover disabled:opacity-40";
const SIDEBAR_SMALL_ACTION_BUTTON_CLASS =
  "rounded p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text-secondary disabled:opacity-40";

export type CategoryManagerProps = {
  categories: Category[];
  categoryDraft: string;
  categoryEditDraft: string;
  categoryError: string | null;
  deletingCategoryId: number | null;
  editingCategoryId: number | null;
  isOpen: boolean;
  isSavingCategory: boolean;
  isUpdatingCategory: boolean;
  notes: Note[];
  onCancelRename: () => void;
  onCategoryDraftChange: (value: string) => void;
  onCategoryEditDraftChange: (value: string) => void;
  onCreate: () => void;
  onDelete: (category: Category, noteCount: number) => void;
  onRename: (categoryId: number) => void;
  onStartRename: (category: Category) => void;
  onToggle: () => void;
  scopeSummary: string;
};

export function CategoryManager({
  categories,
  categoryDraft,
  categoryEditDraft,
  categoryError,
  deletingCategoryId,
  editingCategoryId,
  isOpen,
  isSavingCategory,
  isUpdatingCategory,
  notes,
  onCancelRename,
  onCategoryDraftChange,
  onCategoryEditDraftChange,
  onCreate,
  onDelete,
  onRename,
  onStartRename,
  onToggle,
  scopeSummary,
}: CategoryManagerProps) {
  function handleCreate(event: FormEvent) {
    event.preventDefault();
    onCreate();
  }

  function handleRename(event: FormEvent, categoryId: number) {
    event.preventDefault();
    onRename(categoryId);
  }

  return (
    <div className="shrink-0 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <button
          aria-expanded={isOpen}
          className="inline-flex min-w-0 items-center gap-1 rounded-md px-2 py-1.5 text-[14px] font-semibold text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          onClick={onToggle}
          type="button"
        >
          {isOpen ? (
            <ChevronDown aria-hidden="true" size={16} strokeWidth={2} />
          ) : (
            <ChevronRight aria-hidden="true" size={16} strokeWidth={2} />
          )}
          Categories
        </button>
        <span className="shrink-0 text-[11px] text-text-muted">{scopeSummary}</span>
      </div>

      {isOpen ? (
        <div aria-label="Manage categories" className="surface-card mt-2 p-2" role="region">
          <form className="flex gap-1.5" onSubmit={handleCreate}>
            <input
              aria-label="New category name"
              autoComplete="off"
              className="surface-input min-w-0 flex-1 bg-bg px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-muted outline-none transition-colors focus:bg-surface disabled:opacity-60"
              disabled={isSavingCategory}
              onChange={(event) => onCategoryDraftChange(event.target.value)}
              placeholder="New category"
              value={categoryDraft}
            />
            <button
              aria-label="Add category"
              className={`${SIDEBAR_ACCENT_BUTTON_CLASS} rounded-md px-2.5 py-2`}
              disabled={isSavingCategory}
              type="submit"
            >
              <Plus size={14} strokeWidth={2} />
            </button>
          </form>

          {categories.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1.5">
              {categories.map((category) => {
                const noteCount = notes.filter((note) => note.category?.id === category.id).length;
                const isEditingCategory = editingCategoryId === category.id;

                return (
                  <div className="rounded bg-bg px-2.5 py-2.5" key={category.id}>
                    {isEditingCategory ? (
                      <form
                        className="flex gap-1.5"
                        onSubmit={(event) => handleRename(event, category.id)}
                      >
                        <input
                          aria-label="Category name"
                          autoComplete="off"
                          className="surface-input min-w-0 flex-1 bg-surface px-2.5 py-1.5 text-[13px] text-text-primary outline-none transition-colors focus:bg-surface-hover disabled:opacity-60"
                          disabled={isUpdatingCategory}
                          onChange={(event) => onCategoryEditDraftChange(event.target.value)}
                          value={categoryEditDraft}
                        />
                        <button
                          aria-label="Save category"
                          className={SIDEBAR_ACCENT_ICON_BUTTON_CLASS}
                          disabled={isUpdatingCategory}
                          type="submit"
                        >
                          <Check size={14} strokeWidth={2} />
                        </button>
                        <button
                          aria-label="Cancel category rename"
                          className={SIDEBAR_SMALL_ACTION_BUTTON_CLASS}
                          disabled={isUpdatingCategory}
                          onClick={onCancelRename}
                          type="button"
                        >
                          <X size={14} strokeWidth={2} />
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                          {category.name}
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
                          {noteCount}
                        </span>
                        <button
                          aria-label={`Rename ${category.name}`}
                          className={SIDEBAR_SMALL_ACTION_BUTTON_CLASS}
                          disabled={isUpdatingCategory || deletingCategoryId !== null}
                          onClick={() => onStartRename(category)}
                          type="button"
                        >
                          <Pencil size={13} strokeWidth={2} />
                        </button>
                        <button
                          aria-label={`Delete ${category.name}`}
                          className={`${SIDEBAR_SMALL_ACTION_BUTTON_CLASS} hover:bg-error-muted hover:text-error`}
                          disabled={isUpdatingCategory || deletingCategoryId !== null}
                          onClick={() => onDelete(category, noteCount)}
                          type="button"
                        >
                          <Trash2 size={13} strokeWidth={2} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {categoryError ? (
        <p className="mt-1.5 px-0.5 text-xs text-error">{categoryError}</p>
      ) : null}
    </div>
  );
}
