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

interface HandoffExchangeResponse {
  token: string;
  user: FrontendUser;
}

export function getStoredToken() {
  return window.sessionStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): FrontendUser | null {
  const raw = window.sessionStorage.getItem(USER_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as FrontendUser;
  } catch {
    window.sessionStorage.removeItem(USER_KEY);
    return null;
  }
}

export function storeSession(session: AuthSession) {
  window.sessionStorage.setItem(TOKEN_KEY, session.token);
  window.sessionStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

export function clearSession() {
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(USER_KEY);
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
