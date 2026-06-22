import { sign } from "hono/jwt";
import type { UserRepository } from "./users.ts";

const TEST_USERNAME = "admin";
const TEST_PASSWORD = "foodism123";
const DEFAULT_JWT_SECRET = "proma-server-dev-secret";
const TOKEN_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

export interface LoginRequest {
  username: string;
  password: string;
}

export interface ApiUser {
  id: string;
  username: string;
  displayName: string;
}

export interface AuthTokenPayload {
  sub: string;
  username: string;
  displayName: string;
  exp: number;
  iat: number;
}

export interface LoginResponse {
  token: string;
  user: ApiUser;
}

const TEST_USER: ApiUser = {
  id: TEST_USERNAME,
  username: TEST_USERNAME,
  displayName: "管理员",
};

export function getJwtSecret() {
  const secret = Bun.env.PROMA_SERVER_JWT_SECRET;
  if (secret) {
    return secret;
  }

  console.warn("[认证] 未配置 PROMA_SERVER_JWT_SECRET，使用开发默认密钥");
  return DEFAULT_JWT_SECRET;
}

export function isLoginRequest(value: unknown): value is LoginRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const input = value as Record<string, unknown>;
  return typeof input.username === "string" && typeof input.password === "string";
}

export function validateLogin(input: LoginRequest): ApiUser | null {
  const username = input.username.trim();
  if (username !== TEST_USERNAME || input.password !== TEST_PASSWORD) {
    return null;
  }

  return TEST_USER;
}

export async function authenticateLogin(input: LoginRequest, userRepository: UserRepository | null): Promise<ApiUser | null> {
  if (!userRepository) {
    return validateLogin(input);
  }

  const username = input.username.trim();
  const user = await userRepository.findByUsername(username);
  if (!user) {
    return null;
  }

  const passwordMatched = await Bun.password.verify(input.password, user.passwordHash);
  if (!passwordMatched) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
  };
}

export async function createLoginResponse(user: ApiUser, secret: string): Promise<LoginResponse> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: AuthTokenPayload = {
    sub: user.id,
    username: user.username,
    displayName: user.displayName,
    iat: issuedAt,
    exp: issuedAt + TOKEN_EXPIRES_IN_SECONDS,
  };

  const token = await sign({ ...payload }, secret, "HS256");
  return { token, user };
}

export function userFromTokenPayload(payload: AuthTokenPayload): ApiUser {
  return {
    id: payload.sub,
    username: payload.username,
    displayName: payload.displayName,
  };
}

export async function resolveUserFromTokenPayload(
  payload: AuthTokenPayload,
  userRepository: UserRepository | null,
): Promise<ApiUser> {
  if (!userRepository) {
    return userFromTokenPayload(payload);
  }

  const user = await userRepository.findById(payload.sub);
  return user ?? userFromTokenPayload(payload);
}
