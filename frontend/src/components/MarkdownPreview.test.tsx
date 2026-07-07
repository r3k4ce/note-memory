import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { MarkdownPreview } from "./MarkdownPreview";

afterEach(() => {
  cleanup();
});

describe("MarkdownPreview", () => {
  test("shows leading YAML frontmatter as literal note text", () => {
    const frontmatter = ["---", "title: Draft title", "---"].join("\n");
    render(<MarkdownPreview source={[frontmatter, "", "# Draft title"].join("\n")} />);

    const frontmatterCode = screen.getByText(
      (_, element) => element?.tagName.toLowerCase() === "code" && element.textContent === frontmatter,
    );

    expect(frontmatterCode).toBeInTheDocument();
    expect(frontmatterCode.closest("pre")).toHaveClass("note-frontmatter");
    expect(screen.getByRole("heading", { name: "Draft title" })).toBeInTheDocument();
  });

  test("renders read mode inside the shared workspace page shell with the toolbar", () => {
    render(
      <MarkdownPreview
        source="# Draft title"
        toolbar={<div role="toolbar" aria-label="Note toolbar">Toolbar</div>}
      />,
    );

    const preview = screen.getByRole("heading", { name: "Draft title" }).closest(".markdown-page-surface");

    expect(preview).toHaveClass("workspace-page-shell", "markdown-page-surface");
    expect(preview).toContainElement(screen.getByRole("toolbar", { name: "Note toolbar" }));
    expect(preview?.querySelector(".note-preview")).toHaveClass("prose");
  });
});
