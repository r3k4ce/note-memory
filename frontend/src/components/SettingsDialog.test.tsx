import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { SettingsDialog } from "./SettingsDialog";

vi.mock("./ThemeMenu", () => ({
  AppearanceSettings: () => <section aria-label="Appearance settings">Appearance controls</section>,
}));
vi.mock("./MemoryManager", () => ({
  MemorySettings: () => <section aria-label="Memory settings">Memory controls</section>,
}));

afterEach(cleanup);

describe("SettingsDialog", () => {
  test("is labelled, focuses close, and renders Appearance before Memory", () => {
    render(<SettingsDialog onClose={vi.fn()} triggerRef={createRef<HTMLButtonElement>()} />);

    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog).toHaveClass("max-w-2xl", "max-h-[80vh]");
    expect(screen.getByRole("button", { name: "Close settings" })).toHaveFocus();
    expect(screen.getByLabelText("Appearance settings").compareDocumentPosition(screen.getByLabelText("Memory settings")))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  test("dismisses from close, backdrop, and Escape and restores trigger focus", () => {
    const triggerRef = createRef<HTMLButtonElement>();
    const onClose = vi.fn();
    render(
      <div>
        <button ref={triggerRef}>Settings trigger</button>
        <SettingsDialog onClose={onClose} triggerRef={triggerRef} />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(triggerRef.current).toHaveFocus();

    fireEvent.mouseDown(screen.getByTestId("settings-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  test("does not dismiss when the dialog surface is pressed", () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} triggerRef={createRef<HTMLButtonElement>()} />);
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Settings" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
