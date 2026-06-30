import { beforeEach, describe, expect, test } from "bun:test";
import type { KeyValueCache } from "../../cache/key-value.ts";
import {
  getRebuildLoginSession,
  invalidateRebuildLoginSession,
  resetRebuildLoginSessionForTests,
} from "./login-session.ts";

interface CacheWrite {
  key: string;
  value: string;
  ttlSeconds: number;
}

function setLoginEnv(): () => void {
  const originalBaseUrl = Bun.env.REBUILD_BASE_URL;
  const originalAppId = Bun.env.REBUILD_APP_ID;
  const originalAppSecret = Bun.env.REBUILD_APP_SECRET;
  const originalLoginUser = Bun.env.REBUILD_LOGIN_USER;
  const originalLoginPassword = Bun.env.REBUILD_LOGIN_PASSWORD;
  const originalTtl = Bun.env.REBUILD_LOGIN_COOKIE_TTL_SECONDS;

  Bun.env.REBUILD_BASE_URL = "https://sale.foodism.cc/gw/api";
  Bun.env.REBUILD_APP_ID = "app-id";
  Bun.env.REBUILD_APP_SECRET = "app-secret";
  Bun.env.REBUILD_LOGIN_USER = "tester";
  Bun.env.REBUILD_LOGIN_PASSWORD = "secret";
  Bun.env.REBUILD_LOGIN_COOKIE_TTL_SECONDS = "600";

  return () => {
    Bun.env.REBUILD_BASE_URL = originalBaseUrl;
    Bun.env.REBUILD_APP_ID = originalAppId;
    Bun.env.REBUILD_APP_SECRET = originalAppSecret;
    Bun.env.REBUILD_LOGIN_USER = originalLoginUser;
    Bun.env.REBUILD_LOGIN_PASSWORD = originalLoginPassword;
    Bun.env.REBUILD_LOGIN_COOKIE_TTL_SECONDS = originalTtl;
  };
}

describe("REBUILD 登录 Session", () => {
  beforeEach(() => {
    resetRebuildLoginSessionForTests();
  });

  test("Given cached cookie exists, When getting login session, Then it uses cache without logging in", async () => {
    const restoreEnv = setLoginEnv();
    const fetchCalls: string[] = [];
    const cache: KeyValueCache = {
      async get() {
        return JSON.stringify({
          cookie: "JSESSIONID=cached",
          expiresAt: Date.now() + 60_000,
        });
      },
      async set() {},
      async del() {},
    };

    try {
      const session = await getRebuildLoginSession({
        cache,
        async fetchImpl(input) {
          fetchCalls.push(String(input));
          return new Response(null, { status: 500 });
        },
      });

      expect(session?.cookie).toBe("JSESSIONID=cached");
      expect(fetchCalls).toEqual([]);
    } finally {
      restoreEnv();
      resetRebuildLoginSessionForTests();
    }
  });

  test("Given no cached cookie, When login succeeds, Then it writes cookie to cache", async () => {
    const restoreEnv = setLoginEnv();
    const writes: CacheWrite[] = [];
    const cache: KeyValueCache = {
      async get() {
        return null;
      },
      async set(key, value, ttlSeconds) {
        writes.push({ key, value, ttlSeconds });
      },
      async del() {},
    };

    try {
      const session = await getRebuildLoginSession({
        cache,
        async fetchImpl(input) {
          const url = String(input);
          if (url.includes("/gw/api/login-token")) {
            return new Response(JSON.stringify({
              error_code: 0,
              error_msg: "调用成功",
              data: { login_url: "https://sale.foodism.cc/user/login?token=login-token-1" },
            }));
          }
          return new Response(null, {
            status: 302,
            headers: {
              "set-cookie": "JSESSIONID=session-1; Path=/; HttpOnly",
            },
          });
        },
      });

      expect(session?.cookie).toBe("JSESSIONID=session-1");
      expect(writes).toHaveLength(1);
      expect(writes[0]?.key).toStartWith("rebuild:login-session:");
      expect(JSON.parse(writes[0]?.value ?? "{}")).toMatchObject({ cookie: "JSESSIONID=session-1" });
      expect(writes[0]?.ttlSeconds).toBeGreaterThan(0);
      expect(writes[0]?.ttlSeconds).toBeLessThanOrEqual(600);
    } finally {
      restoreEnv();
      resetRebuildLoginSessionForTests();
    }
  });

  test("Given cached cookie is invalid, When invalidating session, Then it deletes cache key", async () => {
    const restoreEnv = setLoginEnv();
    const deletedKeys: string[] = [];
    const cache: KeyValueCache = {
      async get() {
        return null;
      },
      async set() {},
      async del(key) {
        deletedKeys.push(key);
      },
    };

    try {
      await invalidateRebuildLoginSession("tester", cache);

      expect(deletedKeys).toHaveLength(1);
      expect(deletedKeys[0]).toStartWith("rebuild:login-session:");
    } finally {
      restoreEnv();
      resetRebuildLoginSessionForTests();
    }
  });
});
