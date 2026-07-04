import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ThemeMenu } from "./ThemeMenu";

describe("ThemeMenu", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = "dark";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete document.documentElement.dataset.theme;
  });

  test("renders the sun/moon toggle and chevron", () => {
    render(<ThemeMenu />);
    expect(screen.getByLabelText("Switch to light theme")).toBeInTheDocument();
    expect(screen.getByLabelText("Browse themes")).toBeInTheDocument();
  });

  test("clicking the toggle switches to the opposite default mode", () => {
    render(<ThemeMenu />);
    const toggle = screen.getByLabelText("Switch to light theme");

    fireEvent.click(toggle);

    expect(screen.getByLabelText("Switch to dark theme")).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  test("clicking the chevron opens the menu with variants for the current mode", () => {
    render(<ThemeMenu />);
    fireEvent.click(screen.getByLabelText("Browse themes"));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Midnight/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Forest/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitemradio", { name: /Daylight/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitemradio", { name: /Solarized/ })).not.toBeInTheDocument();
  });

  test("selecting a variant updates the theme and closes the menu", () => {
    render(<ThemeMenu />);
    fireEvent.click(screen.getByLabelText("Browse themes"));

    fireEvent.click(screen.getByRole("menuitemradio", { name: /Forest/ }));

    expect(document.documentElement.dataset.theme).toBe("forest");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("Escape closes the menu without changing the theme", () => {
    render(<ThemeMenu />);
    fireEvent.click(screen.getByLabelText("Browse themes"));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  test("clicking outside closes the menu", () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <ThemeMenu />
      </div>,
    );
    fireEvent.click(screen.getByLabelText("Browse themes"));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("marks the active variant as checked", () => {
    render(<ThemeMenu />);
    fireEvent.click(screen.getByLabelText("Browse themes"));

    const active = screen.getByRole("menuitemradio", { name: /Midnight/ });
    expect(active).toHaveAttribute("aria-checked", "true");
    const inactive = screen.getByRole("menuitemradio", { name: /Forest/ });
    expect(inactive).toHaveAttribute("aria-checked", "false");
  });

  test("switching to light mode shows the light variants in the menu", () => {
    render(<ThemeMenu />);
    fireEvent.click(screen.getByLabelText("Switch to light theme"));
    fireEvent.click(screen.getByLabelText("Browse themes"));

    expect(screen.getByRole("menuitemradio", { name: /Daylight/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Solarized/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitemradio", { name: /Midnight/ })).not.toBeInTheDocument();
  });
});