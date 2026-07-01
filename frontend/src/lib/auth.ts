import { getApiBaseUrl } from "./config.ts";

const TOKEN_KEY = "proma_frontend_token";
const USER_KEY = "proma_frontend_user";

export interface FrontendUser {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface AuthSession {
  token: string;
  user: FrontendUser;
}

interface HandoffLoadState {
  token: string | null;
  isHandoffLoading: boolean;
}

interface HandoffExchangeResponse {
  token: string;
  user: FrontendUser;
}

export function getStoredToken() {
  const token = readStorageValue(TOKEN_KEY);
  if (token) {
    return token;
  }
  return consumeUrlApiToken();
}

export function getStoredUser(): FrontendUser | null {
  const raw = readStorageValue(USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as FrontendUser;
  } catch {
    removeStorageValue(USER_KEY);
    return null;
  }
}

export function storeSession(session: AuthSession) {
  writeStorageValue(TOKEN_KEY, session.token);
  writeStorageValue(USER_KEY, JSON.stringify(session.user));
}

export function clearSession() {
  removeStorageValue(TOKEN_KEY);
  removeStorageValue(USER_KEY);
}

export function shouldWaitForHandoff(state: HandoffLoadState): boolean {
  return state.isHandoffLoading && !state.token;
}

export function removeHandoffFromUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!url.searchParams.has("handoff")) {
      return value;
    }
    url.searchParams.delete("handoff");
    return url.toString();
  } catch {
    return value;
  }
}

export function clearHandoffFromCurrentUrl(): void {
  if (typeof window === "undefined" || !window.location?.href) {
    return;
  }

  const nextUrl = removeHandoffFromUrl(window.location.href);
  if (nextUrl === window.location.href) {
    return;
  }

  if (window.history?.replaceState) {
    window.history.replaceState(null, "", nextUrl);
    return;
  }
  window.location.href = nextUrl;
}

function consumeUrlApiToken(): string | null {
  if (!window.location?.href) {
    return null;
  }
  const url = new URL(window.location.href);
  const token = url.searchParams.get("apiToken")?.trim() || null;
  if (!token) {
    return null;
  }

  writeStorageValue(TOKEN_KEY, token);
  url.searchParams.delete("apiToken");
  if (window.history?.replaceState) {
    window.history.replaceState(null, "", url.toString());
  } else {
    window.location.href = url.toString();
  }
  return token;
}

function readStorageValue(key: string): string | null {
  return safeGetItem(window.localStorage, key) ?? safeGetItem(window.sessionStorage, key);
}

function writeStorageValue(key: string, value: string) {
  safeSetItem(window.localStorage, key, value);
  safeSetItem(window.sessionStorage, key, value);
}

function removeStorageValue(key: string) {
  safeRemoveItem(window.localStorage, key);
  safeRemoveItem(window.sessionStorage, key);
}

function safeGetItem(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSetItem(storage: Storage | undefined, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    // 浏览器隐私模式或嵌入环境禁用存储时忽略，保留另一种存储兜底。
  }
}

function safeRemoveItem(storage: Storage | undefined, key: string) {
  try {
    storage?.removeItem(key);
  } catch {
    // 浏览器隐私模式或嵌入环境禁用存储时忽略。
  }
}

export async function exchangeHandoffToken(handoffToken: string): Promise<AuthSession> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/handoff/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ handoffToken }),
  });

  if (!response.ok) {
    throw new Error(`PC 登录态桥接失败：${response.status}`);
  }

  const session = (await response.json()) as HandoffExchangeResponse;
  storeSession(session);
  return session;
}
