import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { AppearanceSettings } from "./ThemeMenu";

describe("AppearanceSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = "dark";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.theme;
  });

  test("renders mode and current-mode variants without a menu trigger", () => {
    render(<AppearanceSettings />);
    expect(screen.getByLabelText("Switch to light theme")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Cocoa/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Matcha/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Browse themes")).not.toBeInTheDocument();
  });

  test("clicking the toggle switches to the opposite default mode", () => {
    render(<AppearanceSettings />);
    const toggle = screen.getByLabelText("Switch to light theme");

    fireEvent.click(toggle);

    expect(screen.getByLabelText("Switch to dark theme")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  test("shows only variants for the current mode", () => {
    render(<AppearanceSettings />);
    expect(screen.getByRole("radio", { name: /Cocoa/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Matcha/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Biscuit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Honey/ })).not.toBeInTheDocument();
  });

  test("selecting a variant updates the theme in place", () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByRole("radio", { name: /Matcha/ }));

    expect(document.documentElement.dataset.theme).toBe("forest");
    expect(screen.getByRole("radio", { name: /Matcha/ })).toBeChecked();
  });

  test("marks the active variant as checked", () => {
    render(<AppearanceSettings />);

    expect(screen.getByRole("radio", { name: /Cocoa/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Matcha/ })).not.toBeChecked();
  });

  test("switching to light mode shows the light variants in the menu", () => {
    render(<AppearanceSettings />);
    fireEvent.click(screen.getByLabelText("Switch to light theme"));

    expect(screen.getByRole("radio", { name: /Biscuit/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Honey/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Cocoa/ })).not.toBeInTheDocument();
  });
});
