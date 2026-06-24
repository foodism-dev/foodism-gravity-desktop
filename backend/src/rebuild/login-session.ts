import { createHash } from "node:crypto";
import type { KeyValueCache } from "../cache/key-value.ts";
import { getRedisKeyValueCache } from "../cache/redis.ts";
import type { R2Fetch } from "../skill-publisher.ts";
import { buildRebuildOpenApiUrl, readJsonResponse } from "./openapi.ts";

interface RebuildLoginTokenData {
  login_token?: string;
  login_url?: string;
}

export interface RebuildLoginSession {
  user: string;
  cookie: string;
  expiresAt: number;
}

interface StoredRebuildLoginSession {
  cookie: string;
  expiresAt: number;
}

export interface RebuildLoginSessionInput {
  fetchImpl: R2Fetch;
  cache?: KeyValueCache | null;
}

const DEFAULT_LOGIN_SESSION_TTL_SECONDS = 30 * 60;
const CACHE_KEY_PREFIX = "rebuild:login-session";

let memorySession: RebuildLoginSession | null = null;

function readRebuildLoginConfig(): { user: string; password: string } | null {
  const user = Bun.env.REBUILD_LOGIN_USER?.trim();
  const password = Bun.env.REBUILD_LOGIN_PASSWORD?.trim();
  if (!user || !password) {
    return null;
  }
  return { user, password };
}

function readLoginSessionTtlSeconds(): number {
  const parsed = Number.parseInt(Bun.env.REBUILD_LOGIN_COOKIE_TTL_SECONDS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LOGIN_SESSION_TTL_SECONDS;
}

function buildLoginSessionCacheKey(user: string): string {
  const userHash = createHash("sha256").update(user).digest("hex").slice(0, 16);
  return `${CACHE_KEY_PREFIX}:${userHash}`;
}

function parseCookieHeader(setCookie: string | null): string {
  if (!setCookie) {
    return "";
  }
  return setCookie
    .split(/,(?=\s*[^;,]+=)/)
    .map((cookie) => cookie.trim().split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

function parseStoredSession(user: string, value: string): RebuildLoginSession | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredRebuildLoginSession>;
    if (typeof parsed.cookie !== "string" || !parsed.cookie || typeof parsed.expiresAt !== "number") {
      return null;
    }
    return {
      user,
      cookie: parsed.cookie,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

async function readCachedSession(user: string, cache: KeyValueCache | null): Promise<RebuildLoginSession | null> {
  if (memorySession && memorySession.user === user && memorySession.expiresAt > Date.now()) {
    return memorySession;
  }

  if (!cache) {
    return null;
  }

  const cacheKey = buildLoginSessionCacheKey(user);
  try {
    const cached = await cache.get(cacheKey);
    if (!cached) {
      return null;
    }
    const session = parseStoredSession(user, cached);
    if (!session || session.expiresAt <= Date.now()) {
      await cache.del(cacheKey);
      return null;
    }
    memorySession = session;
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[REBUILD] Redis 登录 Cookie 读取失败，使用内存缓存: ${message}`);
    return null;
  }
}

async function writeCachedSession(session: RebuildLoginSession, cache: KeyValueCache | null): Promise<void> {
  memorySession = session;
  if (!cache) {
    return;
  }

  const ttlSeconds = Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000));
  try {
    await cache.set(buildLoginSessionCacheKey(session.user), JSON.stringify({
      cookie: session.cookie,
      expiresAt: session.expiresAt,
    } satisfies StoredRebuildLoginSession), ttlSeconds);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[REBUILD] Redis 登录 Cookie 写入失败，仅使用内存缓存: ${message}`);
  }
}

async function authenticateRebuildSession(
  user: string,
  password: string,
  fetchImpl: R2Fetch,
): Promise<RebuildLoginSession | null> {
  const loginTokenUrl = buildRebuildOpenApiUrl("login-token", { user, password });
  const loginTokenResponse = await readJsonResponse<RebuildLoginTokenData>(await fetchImpl(loginTokenUrl));
  const loginUrl = loginTokenResponse.data?.login_url;
  if (loginTokenResponse.error_code !== 0 || !loginUrl) {
    console.warn(`[REBUILD] 登录 token 获取失败: ${loginTokenResponse.error_msg}`);
    return null;
  }

  const loginResponse = await fetchImpl(loginUrl, { redirect: "manual" });
  const cookie = parseCookieHeader(loginResponse.headers.get("set-cookie"));
  if (!cookie) {
    console.warn("[REBUILD] 登录成功但未拿到 Cookie，本地文件下载不可用");
    return null;
  }

  return {
    user,
    cookie,
    expiresAt: Date.now() + readLoginSessionTtlSeconds() * 1000,
  };
}

export async function getRebuildLoginSession(input: RebuildLoginSessionInput): Promise<RebuildLoginSession | null> {
  const config = readRebuildLoginConfig();
  if (!config) {
    return null;
  }

  const cache = input.cache === undefined ? getRedisKeyValueCache() : input.cache;
  const cached = await readCachedSession(config.user, cache);
  if (cached) {
    return cached;
  }

  try {
    const session = await authenticateRebuildSession(config.user, config.password, input.fetchImpl);
    if (!session) {
      return null;
    }
    await writeCachedSession(session, cache);
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[REBUILD] 登录下载准备失败，本地文件下载不可用: ${message}`);
    return null;
  }
}

export async function warmRebuildLoginSession(fetchImpl: R2Fetch = fetch): Promise<boolean> {
  const session = await getRebuildLoginSession({ fetchImpl });
  return Boolean(session);
}

export async function invalidateRebuildLoginSession(user: string | null = null, cache: KeyValueCache | null = getRedisKeyValueCache()): Promise<void> {
  const targetUser = user ?? memorySession?.user ?? readRebuildLoginConfig()?.user ?? null;
  memorySession = null;
  if (!targetUser || !cache) {
    return;
  }

  try {
    await cache.del(buildLoginSessionCacheKey(targetUser));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[REBUILD] Redis 登录 Cookie 删除失败: ${message}`);
  }
}

export function resetRebuildLoginSessionForTests(): void {
  memorySession = null;
}
