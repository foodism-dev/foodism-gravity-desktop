import { describe, expect, test } from 'bun:test'

import { createAuthHeaders, fetchCurrentPortalMe, resolveServerApiBaseUrl } from './server-api'

describe('server api client', () => {
  test('Given no custom server url When resolving base url Then it uses local Hono server', () => {
    expect(resolveServerApiBaseUrl()).toBe('http://localhost:8787')
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
      const data = await fetchCurrentPortalMe('token-value')

      expect(data.portal).toEqual({ id: 'portal-1', name: '万店引力' })
      expect(String(calls[0]?.url)).toBe('http://localhost:8787/api/me')
      expect(new Headers(calls[0]?.init?.headers).get('Authorization')).toBe('Bearer token-value')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
