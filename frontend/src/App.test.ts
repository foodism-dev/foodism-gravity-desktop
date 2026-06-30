import { describe, expect, test } from "bun:test";

describe("App Lin-Ke test skip state", () => {
  test("Given Lin-Ke skip toggle, When App manages state, Then it persists in localStorage", async () => {
    const source = await Bun.file("frontend/src/App.tsx").text();

    expect(source).toContain("proma_lin_ke_test_skip_enabled");
    expect(source).toContain("window.localStorage.getItem");
    expect(source).toContain("window.localStorage.setItem");
    expect(source).toContain("VITE_LIN_KE_TEST_SKIP_ENABLED");
  });
});
