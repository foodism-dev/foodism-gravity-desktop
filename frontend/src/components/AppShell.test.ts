import { describe, expect, test } from "bun:test";

import { getAppShellMainClassName, shouldHideAppShellHeader } from "./AppShell.tsx";

describe("AppShell", () => {
  test("Given tickets pages, When deciding app shell header visibility, Then it hides the outer header", () => {
    expect(shouldHideAppShellHeader("/tickets")).toBe(true);
    expect(shouldHideAppShellHeader("/tickets/944-019efa")).toBe(true);
  });

  test("Given non-ticket pages, When deciding app shell header visibility, Then it keeps the outer header", () => {
    expect(shouldHideAppShellHeader("/")).toBe(false);
  });

  test("Given ticket detail page, When rendering app shell main, Then it removes outer width limit and page padding", () => {
    expect(getAppShellMainClassName("/tickets/944-019efa")).toBe("w-full max-w-none px-0 py-0");
  });

  test("Given ticket list page, When rendering app shell main, Then it keeps the standard readable container", () => {
    expect(getAppShellMainClassName("/tickets")).toBe("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-3");
  });
});
