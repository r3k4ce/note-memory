import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { CategoryManager, type CategoryManagerProps } from "./CategoryManager";
import type { Category, Note } from "../../types";

afterEach(cleanup);

const category: Category = {
  id: 1,
  name: "Work",
  slug: "work",
  created_at: "2026-07-01",
  updated_at: "2026-07-01",
};
const note: Note = {
  id: 10,
  original_text: "Body",
  ai_title: "Work note",
  short_summary: "Summary",
  tags: [],
  date_added: "2026-07-03T00:00:00Z",
  updated_at: "2026-07-03T00:00:00Z",
  category,
  needs_ai_organization: false,
};

function createProps(overrides: Partial<CategoryManagerProps> = {}): CategoryManagerProps {
  return {
    categories: [category],
    categoryDraft: "",
    categoryEditDraft: "",
    categoryError: null,
    deletingCategoryId: null,
    editingCategoryId: null,
    isOpen: false,
    isSavingCategory: false,
    isUpdatingCategory: false,
    notes: [note],
    onCancelRename: vi.fn(),
    onCategoryDraftChange: vi.fn(),
    onCategoryEditDraftChange: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onStartRename: vi.fn(),
    onToggle: vi.fn(),
    scopeSummary: "All notes selected",
    ...overrides,
  };
}

describe("CategoryManager", () => {
  test("keeps the manager collapsed and forwards its toggle", () => {
    const onToggle = vi.fn();
    render(<CategoryManager {...createProps({ onToggle })} />);

    const button = screen.getByRole("button", { name: "Categories" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("All notes selected")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Manage categories" })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  test("renders category forms and forwards create, rename, cancel, and delete actions", () => {
    const actions = {
      onCancelRename: vi.fn(),
      onCategoryDraftChange: vi.fn(),
      onCategoryEditDraftChange: vi.fn(),
      onCreate: vi.fn(),
      onDelete: vi.fn(),
      onRename: vi.fn(),
      onStartRename: vi.fn(),
    };
    const { rerender } = render(<CategoryManager {...createProps({ isOpen: true, ...actions })} />);
    const manager = screen.getByRole("region", { name: "Manage categories" });

    fireEvent.change(within(manager).getByRole("textbox", { name: "New category name" }), {
      target: { value: "Research" },
    });
    fireEvent.submit(within(manager).getByRole("textbox", { name: "New category name" }).closest("form")!);
    fireEvent.click(within(manager).getByRole("button", { name: "Rename Work" }));
    fireEvent.click(within(manager).getByRole("button", { name: "Delete Work" }));

    expect(actions.onCategoryDraftChange).toHaveBeenCalledWith("Research");
    expect(actions.onCreate).toHaveBeenCalledOnce();
    expect(actions.onStartRename).toHaveBeenCalledWith(category);
    expect(actions.onDelete).toHaveBeenCalledWith(category, 1);

    rerender(
      <CategoryManager
        {...createProps({
          categoryEditDraft: "Projects",
          editingCategoryId: category.id,
          isOpen: true,
          ...actions,
        })}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Category name" }), {
      target: { value: "Archive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save category" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel category rename" }));
    expect(actions.onCategoryEditDraftChange).toHaveBeenCalledWith("Archive");
    expect(actions.onRename).toHaveBeenCalledWith(category.id);
    expect(actions.onCancelRename).toHaveBeenCalledOnce();
  });

  test("renders category errors unchanged", () => {
    render(<CategoryManager {...createProps({ categoryError: "Category hit a snag" })} />);
    expect(screen.getByText("Category hit a snag")).toHaveClass("text-error");
  });
});
