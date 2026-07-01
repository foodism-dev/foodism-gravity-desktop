import { describe, expect, test } from "bun:test";

import {
  clearServerSession,
  clearHandoffFromCurrentUrl,
  clearSession,
  getStoredToken,
  getStoredUser,
  storeSession,
} from "./auth.ts";

process.env.VITE_API_BASE_URL = "http://localhost:8787";

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

function installFetchMock() {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return Response.json({ ok: true });
  };
  return calls;
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

  test("Given web session cookie may exist, When clearing server session, Then it asks backend to expire the cookie", async () => {
    installWindow();
    const calls = installFetchMock();

    await clearServerSession();

    expect(calls[0]?.url).toBe("http://localhost:8787/api/auth/logout");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.credentials).toBe("include");
  });
});
