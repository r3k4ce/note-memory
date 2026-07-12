import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  deleteAllMemories,
  deleteMemory,
  getMemorySettings,
  listMemories,
  updateMemory,
  updateMemorySettings,
} from "../api";
import { MemorySettings } from "./MemoryManager";

vi.mock("../api", () => ({
  deleteAllMemories: vi.fn(),
  deleteMemory: vi.fn(),
  getMemorySettings: vi.fn(),
  listMemories: vi.fn(),
  updateMemory: vi.fn(),
  updateMemorySettings: vi.fn(),
}));

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMemorySettings).mockResolvedValue({ available: true, learning_enabled: true });
  vi.mocked(updateMemorySettings).mockResolvedValue({ available: true, learning_enabled: false });
  vi.mocked(listMemories).mockResolvedValue([
    { id: "one", content: "Prefers concise answers.", created_at: null, updated_at: null },
  ]);
});

describe("MemorySettings", () => {
  test("lists edits deletes and toggles learned memory", async () => {
    vi.mocked(updateMemory).mockResolvedValue({
      id: "one",
      content: "Prefers direct answers.",
      created_at: null,
      updated_at: null,
    });
    render(<MemorySettings />);
    expect(await screen.findByDisplayValue("Prefers concise answers.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Learn from chats" })).toBeChecked();

    fireEvent.change(screen.getByDisplayValue("Prefers concise answers."), {
      target: { value: "Prefers direct answers." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));
    await waitFor(() => expect(updateMemory).toHaveBeenCalledWith("one", "Prefers direct answers."));

    fireEvent.click(screen.getByRole("checkbox", { name: "Learn from chats" }));
    await waitFor(() => expect(updateMemorySettings).toHaveBeenCalledWith(false));

    fireEvent.click(screen.getByRole("button", { name: "Forget memory" }));
    await waitFor(() => expect(deleteMemory).toHaveBeenCalledWith("one"));
  });

  test("confirms forget everything and keeps cancellation safe", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<MemorySettings />);
    await screen.findByDisplayValue("Prefers concise answers.");

    fireEvent.click(screen.getByRole("button", { name: "Forget everything" }));
    expect(deleteAllMemories).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Forget everything" }));
    await waitFor(() => expect(deleteAllMemories).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  test("shows loading, unavailable, empty, and error states", async () => {
    let resolveSettings: (value: { available: boolean; learning_enabled: boolean }) => void = () => undefined;
    vi.mocked(getMemorySettings).mockReturnValue(new Promise((resolve) => { resolveSettings = resolve; }));
    vi.mocked(listMemories).mockResolvedValue([]);
    const { rerender } = render(<MemorySettings />);
    expect(screen.getByText("Loading memory…")).toBeInTheDocument();

    resolveSettings({ available: false, learning_enabled: false });
    expect(await screen.findByText(/Memory is unavailable/)).toBeInTheDocument();
    expect(screen.getByText("No learned memories yet.")).toBeInTheDocument();

    vi.mocked(getMemorySettings).mockRejectedValue(new Error("offline"));
    rerender(<MemorySettings key="error" />);
    expect(await screen.findByText("Couldn't open memory right now.")).toBeInTheDocument();
  });
});
