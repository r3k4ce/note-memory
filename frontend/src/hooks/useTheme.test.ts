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

  test("reads stored forest theme from localStorage", () => {
    localStorage.setItem("theme", "forest");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("forest");
    expect(document.documentElement.dataset.theme).toBe("forest");
  });

  test("reads stored solarized theme from localStorage", () => {
    localStorage.setItem("theme", "solarized");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("solarized");
    expect(document.documentElement.dataset.theme).toBe("solarized");
  });

  test("setTheme updates state, dataset, and localStorage for any variant", () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme("forest"));

    expect(result.current.theme).toBe("forest");
    expect(document.documentElement.dataset.theme).toBe("forest");
    expect(localStorage.getItem("theme")).toBe("forest");

    act(() => result.current.setTheme("solarized"));

    expect(result.current.theme).toBe("solarized");
    expect(document.documentElement.dataset.theme).toBe("solarized");
    expect(localStorage.getItem("theme")).toBe("solarized");
  });

  test("toggleTheme switches dark default to light default", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
  });

  test("toggleTheme switches light default to dark default", () => {
    localStorage.setItem("theme", "light");
    const { result } = renderHook(() => useTheme());

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  test("toggleTheme resets variant to the default of the opposite mode", () => {
    localStorage.setItem("theme", "forest");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("forest");

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe("light");

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe("dark");
  });

  test("themesForMode lists variants for each mode", () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current.themesForMode("dark")).toEqual(["dark", "forest"]);
    expect(result.current.themesForMode("light")).toEqual(["light", "solarized"]);
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
      localStorage.setItem("theme", "forest");
      window.dispatchEvent(
        new StorageEvent("storage", { key: "theme", newValue: "forest" }),
      );
    });

    expect(result.current.theme).toBe("forest");
    expect(document.documentElement.dataset.theme).toBe("forest");
  });

  test("ignores storage event with invalid value", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "theme", newValue: "invalid" }),
      );
    });

    expect(result.current.theme).toBe("dark");
  });
});