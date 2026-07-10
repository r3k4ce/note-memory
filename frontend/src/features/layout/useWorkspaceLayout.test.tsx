import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { PaneResizeHandle } from "./PaneResizeHandle";
import {
  LEFT_PANE_MAX_WIDTH,
  RIGHT_PANE_MAX_WIDTH,
  useWorkspaceLayout,
} from "./useWorkspaceLayout";

afterEach(cleanup);

function WorkspaceLayoutHarness() {
  const {
    activeResizeSide,
    gripPositions,
    isFocusEditorShrunk,
    isTextAreaPaneFocused,
    leftPaneClassName,
    leftPaneWidth,
    leftSidebarRef,
    markdownSurfaceRef,
    preFocusCenterWidth,
    rightPaneClassName,
    rightPaneWidth,
    rightSidebarRef,
    setIsFocusEditorShrunk,
    snappedResizeSide,
    startPaneResize,
    toggleTextAreaFocus,
    workspaceCenterContentRef,
    workspaceRootRef,
  } = useWorkspaceLayout();

  return (
    <div ref={workspaceRootRef}>
      <aside
        aria-label="Notes sidebar"
        className={leftPaneClassName}
        ref={leftSidebarRef}
        style={{ width: leftPaneWidth }}
      />
      <PaneResizeHandle
        left={gripPositions.left}
        label="Resize notes sidebar"
        maxWidth={LEFT_PANE_MAX_WIDTH}
        onResizeStart={(event) => startPaneResize("left", event)}
        snapped={activeResizeSide === "left" && snappedResizeSide === "left"}
        width={leftPaneWidth}
      />
      <div
        className="workspace-center-content"
        ref={workspaceCenterContentRef}
        style={{
          width:
            isTextAreaPaneFocused && isFocusEditorShrunk && preFocusCenterWidth !== null
              ? preFocusCenterWidth
              : "100%",
        }}
      >
        <div ref={markdownSurfaceRef} />
      </div>
      <PaneResizeHandle
        className="hidden lg:flex"
        left={gripPositions.right}
        label="Resize Bun"
        maxWidth={RIGHT_PANE_MAX_WIDTH}
        onResizeStart={(event) => startPaneResize("right", event)}
        snapped={activeResizeSide === "right" && snappedResizeSide === "right"}
        width={rightPaneWidth}
      />
      <aside
        aria-label="Bun pane"
        className={rightPaneClassName}
        ref={rightSidebarRef}
        style={{ width: rightPaneWidth }}
      />
      {isTextAreaPaneFocused ? (
        <button
          aria-label={isFocusEditorShrunk ? "Expand editor" : "Shrink editor"}
          onClick={() => setIsFocusEditorShrunk((currentValue) => !currentValue)}
          title={isFocusEditorShrunk ? "Expand editor" : "Shrink editor"}
          type="button"
        />
      ) : null}
      <button
        aria-label={isTextAreaPaneFocused ? "Exit" : "Focus Mode"}
        onClick={toggleTextAreaFocus}
        type="button"
      />
    </div>
  );
}

test("renders accessible pane resize handles with the workspace grip contract", () => {
  render(<WorkspaceLayoutHarness />);

  const sidebarSeparator = screen.getByRole("separator", { name: "Resize notes sidebar" });
  const bunSeparator = screen.getByRole("separator", { name: "Resize Bun" });

  expect(sidebarSeparator).toHaveClass("absolute", "h-8", "w-3.5");
  expect(bunSeparator).toHaveClass("absolute", "h-8", "w-3.5", "hidden", "lg:flex");
  expect(sidebarSeparator).toHaveAttribute("aria-valuemin", "0");
  expect(sidebarSeparator).toHaveAttribute("aria-valuemax", "480");
  expect(sidebarSeparator).toHaveAttribute("aria-valuenow", "320");
  expect(sidebarSeparator.innerHTML).not.toContain("inset-y-0");
  expect(sidebarSeparator.innerHTML).not.toContain("w-px");
});

test("focuses the center, toggles its captured width, and restores both panes", () => {
  const { container } = render(<WorkspaceLayoutHarness />);
  const centerContent = container.querySelector(".workspace-center-content") as HTMLElement;

  centerContent.getBoundingClientRect = () => ({
    bottom: 900,
    height: 900,
    left: 320,
    right: 1088,
    toJSON: () => ({}),
    top: 0,
    width: 768,
    x: 320,
    y: 0,
  });

  fireEvent.click(screen.getByRole("button", { name: "Focus Mode" }));

  expect(screen.getByRole("complementary", { name: "Notes sidebar" })).toHaveStyle({ width: "0px" });
  expect(screen.getByRole("complementary", { name: "Bun pane" })).toHaveStyle({ width: "0px" });

  fireEvent.click(screen.getByRole("button", { name: "Shrink editor" }));
  expect(centerContent).toHaveStyle({ width: "768px" });
  expect(screen.getByRole("button", { name: "Expand editor" })).toHaveAttribute("title", "Expand editor");

  fireEvent.click(screen.getByRole("button", { name: "Exit" }));

  expect(screen.getByRole("complementary", { name: "Notes sidebar" })).toHaveStyle({ width: "320px" });
  expect(screen.getByRole("complementary", { name: "Bun pane" })).toHaveStyle({ width: "352px" });
  expect(screen.queryByRole("button", { name: "Shrink editor" })).not.toBeInTheDocument();
});

test("collapses and restores either pane by dragging its separator", () => {
  render(<WorkspaceLayoutHarness />);

  const sidebar = screen.getByRole("complementary", { name: "Notes sidebar" });
  const notesSeparator = screen.getByRole("separator", { name: "Resize notes sidebar" });
  fireEvent.pointerDown(notesSeparator, { clientX: 288, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 20, pointerId: 1 });
  fireEvent.pointerUp(window, { pointerId: 1 });
  expect(sidebar).toHaveStyle({ width: "0px" });

  fireEvent.pointerDown(notesSeparator, { clientX: 0, pointerId: 2 });
  fireEvent.pointerMove(window, { clientX: 240, pointerId: 2 });
  fireEvent.pointerUp(window, { pointerId: 2 });
  expect(sidebar).toHaveStyle({ width: "240px" });

  const assistant = screen.getByRole("complementary", { name: "Bun pane" });
  const bunSeparator = screen.getByRole("separator", { name: "Resize Bun" });
  fireEvent.pointerDown(bunSeparator, { clientX: 600, pointerId: 3 });
  fireEvent.pointerMove(window, { clientX: 940, pointerId: 3 });
  fireEvent.pointerUp(window, { pointerId: 3 });
  expect(assistant).toHaveStyle({ width: "0px" });

  fireEvent.pointerDown(bunSeparator, { clientX: 940, pointerId: 4 });
  fireEvent.pointerMove(window, { clientX: 620, pointerId: 4 });
  fireEvent.pointerUp(window, { pointerId: 4 });
  expect(assistant).toHaveStyle({ width: "320px" });
});

test("snaps desktop pane resizing to each default width inside the magnet zone", () => {
  render(<WorkspaceLayoutHarness />);

  const sidebar = screen.getByRole("complementary", { name: "Notes sidebar" });
  const notesSeparator = screen.getByRole("separator", { name: "Resize notes sidebar" });
  fireEvent.pointerDown(notesSeparator, { clientX: 320, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 306, pointerId: 1 });
  expect(sidebar).toHaveStyle({ width: "320px" });
  expect(notesSeparator).toHaveClass("resize-handle-grip-snapped");
  fireEvent.pointerUp(window, { pointerId: 1 });

  const assistant = screen.getByRole("complementary", { name: "Bun pane" });
  const bunSeparator = screen.getByRole("separator", { name: "Resize Bun" });
  fireEvent.pointerDown(bunSeparator, { clientX: 900, pointerId: 2 });
  fireEvent.pointerMove(window, { clientX: 915, pointerId: 2 });
  expect(assistant).toHaveStyle({ width: "352px" });
  expect(bunSeparator).toHaveClass("resize-handle-grip-snapped");
  fireEvent.pointerUp(window, { pointerId: 2 });
});

test("keeps desktop resizing continuous outside the default snap zone", () => {
  render(<WorkspaceLayoutHarness />);

  fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize notes sidebar" }), {
    clientX: 320,
    pointerId: 1,
  });
  fireEvent.pointerMove(window, { clientX: 337, pointerId: 1 });
  fireEvent.pointerUp(window, { pointerId: 1 });
  expect(screen.getByRole("complementary", { name: "Notes sidebar" })).toHaveStyle({ width: "337px" });

  fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize Bun" }), {
    clientX: 900,
    pointerId: 2,
  });
  fireEvent.pointerMove(window, { clientX: 883, pointerId: 2 });
  fireEvent.pointerUp(window, { pointerId: 2 });
  expect(screen.getByRole("complementary", { name: "Bun pane" })).toHaveStyle({ width: "369px" });
});

test("does not snap pane resizing below the desktop breakpoint", () => {
  const originalInnerWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });

  try {
    render(<WorkspaceLayoutHarness />);
    fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize notes sidebar" }), {
      clientX: 320,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, { clientX: 306, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(screen.getByRole("complementary", { name: "Notes sidebar" })).toHaveStyle({ width: "306px" });
  } finally {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
  }
});

test("restores snapped defaults after focus mode", () => {
  render(<WorkspaceLayoutHarness />);

  fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize notes sidebar" }), {
    clientX: 320,
    pointerId: 1,
  });
  fireEvent.pointerMove(window, { clientX: 306, pointerId: 1 });
  fireEvent.pointerUp(window, { pointerId: 1 });

  fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize Bun" }), {
    clientX: 900,
    pointerId: 2,
  });
  fireEvent.pointerMove(window, { clientX: 915, pointerId: 2 });
  fireEvent.pointerUp(window, { pointerId: 2 });

  fireEvent.click(screen.getByRole("button", { name: "Focus Mode" }));
  fireEvent.click(screen.getByRole("button", { name: "Exit" }));

  expect(screen.getByRole("complementary", { name: "Notes sidebar" })).toHaveStyle({ width: "320px" });
  expect(screen.getByRole("complementary", { name: "Bun pane" })).toHaveStyle({ width: "352px" });
});

test("resets the captured focus width whenever a pane reopens", () => {
  render(<WorkspaceLayoutHarness />);
  const notesSeparator = screen.getByRole("separator", { name: "Resize notes sidebar" });
  const bunSeparator = screen.getByRole("separator", { name: "Resize Bun" });

  fireEvent.pointerDown(notesSeparator, { clientX: 320, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 20, pointerId: 1 });
  fireEvent.pointerUp(window, { pointerId: 1 });
  expect(screen.queryByRole("button", { name: "Shrink editor" })).not.toBeInTheDocument();

  fireEvent.pointerDown(bunSeparator, { clientX: 1088, pointerId: 2 });
  fireEvent.pointerMove(window, { clientX: 1440, pointerId: 2 });
  fireEvent.pointerUp(window, { pointerId: 2 });
  fireEvent.click(screen.getByRole("button", { name: "Shrink editor" }));
  expect(screen.getByRole("button", { name: "Expand editor" })).toBeInTheDocument();

  fireEvent.pointerDown(notesSeparator, { clientX: 0, pointerId: 3 });
  fireEvent.pointerMove(window, { clientX: 240, pointerId: 3 });
  fireEvent.pointerUp(window, { pointerId: 3 });
  expect(screen.queryByRole("button", { name: "Expand editor" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Shrink editor" })).not.toBeInTheDocument();

  fireEvent.pointerDown(notesSeparator, { clientX: 240, pointerId: 4 });
  fireEvent.pointerMove(window, { clientX: 0, pointerId: 4 });
  fireEvent.pointerUp(window, { pointerId: 4 });
  expect(screen.getByRole("button", { name: "Shrink editor" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Expand editor" })).not.toBeInTheDocument();
});
