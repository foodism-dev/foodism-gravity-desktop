import { describe, expect, test } from "bun:test";

import { createServerApp } from "./app.ts";
import type { ApiUser } from "./auth.ts";
import type { UserRepository, UserWithPasswordHash } from "./users.ts";

interface StatusResponse {
  name: string;
  status: string;
  uptime: number;
  timestamp: string;
}

interface NotFoundResponse {
  error: string;
  message: string;
}

interface LoginResponse {
  token: string;
  user: {
    id: string;
    username: string;
    displayName: string;
  };
}

interface MeResponse {
  user: {
    id: string;
    username: string;
    displayName: string;
  };
}

interface ErrorResponse {
  error: string;
  message: string;
}

function createMemoryUserRepository(user: UserWithPasswordHash): UserRepository {
  return {
    async findById(id: string): Promise<ApiUser | null> {
      return user.id === id
        ? {
            id: user.id,
            username: user.username,
            displayName: "数据库用户",
          }
        : null;
    },

    async findByUsername(username: string): Promise<UserWithPasswordHash | null> {
      return user.username === username ? user : null;
    },
  };
}

describe("server app", () => {
  test("Given the server is running, When health is requested, Then it returns ok", async () => {
    const app = createServerApp();

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("Given the server is running, When status is requested, Then it returns service metadata", async () => {
    const app = createServerApp();

    const response = await app.request("/api/status");
    const body = (await response.json()) as StatusResponse;

    expect(response.status).toBe(200);
    expect(body.name).toBe("@proma/server");
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.timestamp).toBe("string");
  });

  test("Given an unknown route, When it is requested, Then it returns a JSON 404", async () => {
    const app = createServerApp();

    const response = await app.request("/missing");
    const body = (await response.json()) as NotFoundResponse;

    expect(response.status).toBe(404);
    expect(body.error).toBe("Not Found");
    expect(body.message).toBe("请求的资源不存在");
  });

  test("Given valid credentials, When login is requested, Then it returns a jwt token and user info", async () => {
    const app = createServerApp();

    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "foodism123" }),
    });
    const body = (await response.json()) as LoginResponse;

    expect(response.status).toBe(200);
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.user).toEqual({
      id: "admin",
      username: "admin",
      displayName: "管理员",
    });
  });

  test("Given invalid credentials, When login is requested, Then it rejects the request", async () => {
    const app = createServerApp();

    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong-password" }),
    });
    const body = (await response.json()) as ErrorResponse;

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(body.message).toBe("账号或密码错误");
  });

  test("Given no token, When user info is requested, Then it rejects the request", async () => {
    const app = createServerApp();

    const response = await app.request("/api/me");

    expect(response.status).toBe(401);
  });

  test("Given a valid token, When user info is requested, Then it returns current user info", async () => {
    const app = createServerApp();

    const loginResponse = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "foodism123" }),
    });
    const loginBody = (await loginResponse.json()) as LoginResponse;

    const response = await app.request("/api/me", {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    const body = (await response.json()) as MeResponse;

    expect(response.status).toBe(200);
    expect(body.user).toEqual({
      id: "admin",
      username: "admin",
      displayName: "管理员",
    });
  });

  test("Given a user repository, When login is requested, Then it verifies the stored password hash", async () => {
    const passwordHash = await Bun.password.hash("secret-password");
    const app = createServerApp({
      userRepository: createMemoryUserRepository({
        id: "11111111-1111-1111-1111-111111111111",
        username: "pg-user",
        displayName: "PG 用户",
        passwordHash,
      }),
    });

    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "pg-user", password: "secret-password" }),
    });
    const body = (await response.json()) as LoginResponse;

    expect(response.status).toBe(200);
    expect(body.user).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      username: "pg-user",
      displayName: "PG 用户",
    });
  });

  test("Given a valid token and user repository, When user info is requested, Then it returns the latest stored user info", async () => {
    const passwordHash = await Bun.password.hash("secret-password");
    const app = createServerApp({
      userRepository: createMemoryUserRepository({
        id: "11111111-1111-1111-1111-111111111111",
        username: "pg-user",
        displayName: "PG 用户",
        passwordHash,
      }),
    });

    const loginResponse = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "pg-user", password: "secret-password" }),
    });
    const loginBody = (await loginResponse.json()) as LoginResponse;

    const response = await app.request("/api/me", {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    const body = (await response.json()) as MeResponse;

    expect(response.status).toBe(200);
    expect(body.user).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      username: "pg-user",
      displayName: "数据库用户",
    });
  });
});
