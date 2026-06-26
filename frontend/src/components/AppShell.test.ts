import { describe, expect, test } from "bun:test";

import { shouldHideAppShellHeader } from "./AppShell.tsx";

describe("AppShell", () => {
  test("Given tickets pages, When deciding app shell header visibility, Then it hides the outer header", () => {
    expect(shouldHideAppShellHeader("/tickets")).toBe(true);
    expect(shouldHideAppShellHeader("/tickets/944-019efa")).toBe(true);
  });

  test("Given non-ticket pages, When deciding app shell header visibility, Then it keeps the outer header", () => {
    expect(shouldHideAppShellHeader("/")).toBe(false);
  });
});
