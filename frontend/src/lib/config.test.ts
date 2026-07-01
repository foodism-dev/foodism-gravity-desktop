import { describe, expect, test } from "bun:test";

import { getApiBaseUrl, getSsoLoginUrl, isLinKeTestSkipEnabled } from "./config.ts";

function installRuntimeConfig(config: NonNullable<Window["__PROMA_CONFIG__"]>) {
  Object.defineProperty(globalThis, "window", {
    value: {
      __PROMA_CONFIG__: config,
    },
    configurable: true,
  });
}

describe("前端运行时配置", () => {
  test("Given Dokploy runtime config, When reading API settings, Then it overrides build-time env", () => {
    installRuntimeConfig({
      VITE_API_BASE_URL: "https://api.example.com/",
      VITE_SSO_LOGIN_URL: "https://sso.example.com/login",
      VITE_LIN_KE_TEST_SKIP_ENABLED: "true",
    });

    expect(getApiBaseUrl()).toBe("https://api.example.com");
    expect(getSsoLoginUrl()).toBe("https://sso.example.com/login");
    expect(isLinKeTestSkipEnabled()).toBe(true);
  });

  test("Given no SSO runtime override, When reading login URL, Then it falls back to API login route", () => {
    installRuntimeConfig({
      VITE_API_BASE_URL: "https://api.example.com",
    });

    expect(getSsoLoginUrl()).toBe("https://api.example.com/sso_login");
  });
});
