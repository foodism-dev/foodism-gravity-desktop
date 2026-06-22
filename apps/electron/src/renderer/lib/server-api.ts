import type { AuthSession, LoginInput } from '../../types'

const DEFAULT_SERVER_API_BASE_URL = 'http://localhost:8787'

export interface ApiUserInfo {
  id: string
  username: string
  displayName: string
}

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export interface JsonRecord {
  [key: string]: JsonValue
}

interface LoginApiResponse {
  token: string
  user: ApiUserInfo
}

interface MeApiResponse {
  user: ApiUserInfo
}

export interface PortalMeResponse {
  user?: ApiUserInfo
  portal?: JsonValue
  portals?: JsonValue
  [key: string]: unknown
}

interface ApiErrorResponse {
  message?: string
}

export function resolveServerApiBaseUrl(value?: string): string {
  const baseUrl = value?.trim()
  if (!baseUrl) {
    return DEFAULT_SERVER_API_BASE_URL
  }

  return baseUrl.replace(/\/+$/, '')
}

function getServerApiBaseUrl(): string {
  return resolveServerApiBaseUrl(import.meta.env.VITE_PROMA_SERVER_URL)
}

export function createAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
  }
}

async function parseApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorResponse
    return body.message || `请求失败：${response.status}`
  } catch {
    return `请求失败：${response.status}`
  }
}

export async function requestServerApi<TResponse>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<TResponse> {
  const headers = new Headers(init.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${getServerApiBaseUrl()}${path}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    throw new Error(await parseApiError(response))
  }

  return (await response.json()) as TResponse
}

export async function loginWithServerApi(input: LoginInput): Promise<AuthSession> {
  const response = await requestServerApi<LoginApiResponse>('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  return {
    isAuthenticated: true,
    apiToken: response.token,
    user: response.user,
    loggedInAt: new Date().toISOString(),
  }
}

export async function fetchCurrentApiUser(token: string): Promise<ApiUserInfo> {
  const response = await requestServerApi<MeApiResponse>('/api/me', {}, token)
  return response.user
}

export async function fetchCurrentPortalMe(token?: string): Promise<PortalMeResponse> {
  return requestServerApi<PortalMeResponse>('/api/me', {}, token)
}
