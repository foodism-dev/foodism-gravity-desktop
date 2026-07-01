import { describe, expect, test } from "bun:test";

describe("App Lin-Ke test skip state", () => {
  test("Given Lin-Ke skip toggle, When App manages state, Then it persists in localStorage", async () => {
    const appSource = await Bun.file("frontend/src/App.tsx").text();
    const configSource = await Bun.file("frontend/src/lib/config.ts").text();

    expect(appSource).toContain("proma_lin_ke_test_skip_enabled");
    expect(appSource).toContain("window.localStorage.getItem");
    expect(appSource).toContain("window.localStorage.setItem");
    expect(configSource).toContain("__PROMA_CONFIG__");
    expect(configSource).toContain("VITE_LIN_KE_TEST_SKIP_ENABLED");
  });
});
