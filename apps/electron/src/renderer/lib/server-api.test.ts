import { describe, expect, test } from 'bun:test'

import { createAuthHeaders, resolveServerApiBaseUrl } from './server-api'

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
})
