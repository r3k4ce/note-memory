import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useTheme } from "./useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("defaults to dark when no stored value", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  test("reads stored dark theme from localStorage", () => {
    localStorage.setItem("theme", "dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
  });

  test("reads stored light theme from localStorage", () => {
    localStorage.setItem("theme", "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  test("setTheme updates state, dataset, and localStorage", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("light"));

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
  });

  test("toggleTheme switches dark to light", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
  });

  test("toggleTheme switches light to dark", () => {
    localStorage.setItem("theme", "light");
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  test("ignores invalid localStorage values", () => {
    localStorage.setItem("theme", "invalid");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
  });

  test("responds to storage event from another tab", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");

    act(() => {
      localStorage.setItem("theme", "light");
      window.dispatchEvent(
        new StorageEvent("storage", { key: "theme", newValue: "light" }),
      );
    });

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
