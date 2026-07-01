import { describe, expect, test } from "bun:test";

import {
  clearHandoffFromCurrentUrl,
  clearSession,
  getStoredToken,
  getStoredUser,
  shouldWaitForHandoff,
  storeSession,
} from "./auth.ts";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function installWindow(input: {
  href?: string;
  sessionStorage?: StorageLike;
  localStorage?: StorageLike;
} = {}) {
  const sessionStorage = input.sessionStorage ?? createMemoryStorage();
  const localStorage = input.localStorage ?? createMemoryStorage();
  const location = new URL(input.href ?? "http://localhost:5174/tickets?embedded=electron");
  Object.defineProperty(globalThis, "window", {
    value: {
      sessionStorage,
      localStorage,
      location,
      history: {
        replaceState(_state: unknown, _title: string, nextUrl: string) {
          location.href = new URL(nextUrl, location.href).toString();
        },
      },
    },
    configurable: true,
  });
  return { sessionStorage, localStorage };
}

describe("前端登录持久化", () => {
  test("Given stored session, When sessionStorage is reset by reload, Then token and user are restored from localStorage", () => {
    const localStorage = createMemoryStorage();
    installWindow({ localStorage });
    storeSession({
      token: "persisted-token",
      user: { id: "user-1", name: "运营A" },
    });

    installWindow({ localStorage, sessionStorage: createMemoryStorage() });

    expect(getStoredToken()).toBe("persisted-token");
    expect(getStoredUser()).toEqual({ id: "user-1", name: "运营A" });
  });

  test("Given Electron URL apiToken, When reading token, Then it persists token beyond the current session and cleans the URL", () => {
    const { localStorage } = installWindow({
      href: "http://localhost:5174/tickets?embedded=electron&apiToken=pc-token",
    });

    expect(getStoredToken()).toBe("pc-token");
    expect(localStorage.getItem("proma_frontend_token")).toBe("pc-token");
    expect(globalThis.window.location.href).toBe("http://localhost:5174/tickets?embedded=electron");
  });

  test("Given current URL has handoff, When clearing handoff, Then it preserves other search params", () => {
    installWindow({
      href: "http://localhost:5174/tickets?embedded=electron&handoff=used-token&tab=workbench",
    });

    clearHandoffFromCurrentUrl();

    expect(globalThis.window.location.href).toBe("http://localhost:5174/tickets?embedded=electron&tab=workbench");
  });

  test("Given handoff exchange is loading, When authenticated data wants to load, Then it waits for handoff first", () => {
    expect(shouldWaitForHandoff({ token: null, isHandoffLoading: true })).toBe(true);
    expect(shouldWaitForHandoff({ token: "pc-token", isHandoffLoading: false })).toBe(false);
    expect(shouldWaitForHandoff({ token: null, isHandoffLoading: false })).toBe(false);
  });

  test("Given stored session, When clearing session, Then both persistent and session caches are removed", () => {
    const { localStorage, sessionStorage } = installWindow();
    storeSession({
      token: "persisted-token",
      user: { id: "user-1", name: "运营A" },
    });

    clearSession();

    expect(localStorage.getItem("proma_frontend_token")).toBeNull();
    expect(localStorage.getItem("proma_frontend_user")).toBeNull();
    expect(sessionStorage.getItem("proma_frontend_token")).toBeNull();
    expect(sessionStorage.getItem("proma_frontend_user")).toBeNull();
  });
});
