import { describe, expect, test } from 'bun:test'

import { createAuthHeaders, fetchCurrentPortalMe, resolveServerApiBaseUrl } from './server-api'

async function withApiBaseUrl<T>(baseUrl: string, run: () => Promise<T>): Promise<T> {
  const originalBaseUrl = import.meta.env.VITE_API_BASE_URL
  import.meta.env.VITE_API_BASE_URL = baseUrl
  try {
    return await run()
  } finally {
    import.meta.env.VITE_API_BASE_URL = originalBaseUrl
  }
}

describe('server api client', () => {
  test('Given no custom server url When resolving base url Then it throws a config error', () => {
    expect(() => resolveServerApiBaseUrl()).toThrow('缺少 VITE_API_BASE_URL 配置')
  })

  test('Given a custom server url with trailing slash When resolving base url Then it normalizes the url', () => {
    expect(resolveServerApiBaseUrl('http://localhost:9000///')).toBe('http://localhost:9000')
  })

  test('Given a jwt token When creating auth headers Then it returns a bearer authorization header', () => {
    expect(createAuthHeaders('token-value')).toEqual({
      Authorization: 'Bearer token-value',
    })
  })

  test('Given an api token When fetching current portal data Then it calls /api/me with bearer auth', async () => {
    const originalFetch = globalThis.fetch
    const calls: Array<{ url: string | URL | Request, init?: RequestInit }> = []

    const mockFetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
      const [url, init] = args
      calls.push({ url, init })
      return new Response(JSON.stringify({
        user: {
          id: 'user-1',
          username: 'demo',
          displayName: 'Demo User',
        },
        portal: {
          id: 'portal-1',
          name: '万店引力',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    globalThis.fetch = Object.assign(mockFetch, { preconnect: originalFetch.preconnect })

    try {
      await withApiBaseUrl('http://localhost:8787', async () => {
        const data = await fetchCurrentPortalMe('token-value')

        expect(data.portal).toEqual({ id: 'portal-1', name: '万店引力' })
        expect(String(calls[0]?.url)).toBe(`${import.meta.env.VITE_API_BASE_URL}/api/me`)
        expect(new Headers(calls[0]?.init?.headers).get('Authorization')).toBe('Bearer token-value')
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('Given server api returns 401 in Electron When fetching current portal data Then it opens SSO login', async () => {
    const originalFetch = globalThis.fetch
    let ssoLoginStarts = 0
    Object.defineProperty(globalThis, 'window', {
      value: {
        electronAPI: {
          startSsoLogin: async () => {
            ssoLoginStarts += 1
            return { authorizeUrl: 'https://sso.example.com/oauth2/authorize' }
          },
        },
      },
      configurable: true,
    })

    const mockFetch = async (): Promise<Response> => new Response(JSON.stringify({
      message: '登录已过期',
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
    globalThis.fetch = Object.assign(mockFetch, { preconnect: originalFetch.preconnect })

    try {
      await withApiBaseUrl('http://localhost:8787', async () => {
        await expect(fetchCurrentPortalMe('expired-token')).rejects.toThrow('登录已过期')
        expect(ssoLoginStarts).toBe(1)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
