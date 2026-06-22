import { describe, expect, test } from 'bun:test'
import { buildAuthorizeUrl, completeSsoCallback, createPKCEState, getDefaultInternalAuthConfig, getDefaultSsoOidcConfig, requestInternalAuthToken } from './sso-oidc-service'

describe('sso-oidc-service', () => {
  test('Given 固定随机源 When 创建 PKCE 状态 Then 生成 verifier、challenge、state 和 nonce', () => {
    let calls = 0
    const pkce = createPKCEState((size) => {
      calls += 1
      return Buffer.alloc(size, calls)
    })

    expect(pkce.verifier).toBe('AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB')
    expect(pkce.challenge).toBe('gPU_RIwAAtUroAS3jKZXwnjnNcFHrKm3VmhXzo85nRE')
    expect(pkce.state).toBe('AgICAgICAgICAgICAgICAgICAgICAgIC')
    expect(pkce.nonce).toBe('AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD')
  })

  test('Given SSO 配置和 PKCE 状态 When 构建授权地址 Then 使用 Gravity PC OIDC 参数', () => {
    const url = buildAuthorizeUrl(
      {
        ssoIssuer: 'https://sso.example.com',
        clientId: 'gravity-pc',
        redirectUri: 'http://127.0.0.1:47731/callback',
        scope: 'openid profile email offline_access',
      },
      {
        verifier: 'verifier',
        challenge: 'challenge',
        state: 'state-value',
        nonce: 'nonce-value',
      }
    )

    expect(url.origin).toBe('https://sso.example.com')
    expect(url.pathname).toBe('/oauth2/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('gravity-pc')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:47731/callback')
    expect(url.searchParams.get('scope')).toBe('openid profile email offline_access')
    expect(url.searchParams.get('state')).toBe('state-value')
    expect(url.searchParams.get('nonce')).toBe('nonce-value')
    expect(url.searchParams.get('code_challenge')).toBe('challenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('login_hint')).toBe('dingtalk')
  })

  test('Given 有效 callback When 完成 SSO 回调 Then 换取 token 并返回登录会话', async () => {
    const session = await completeSsoCallback({
      requestUrl: new URL('http://127.0.0.1:47731/callback?code=auth-code&state=state-value'),
      redirectUri: 'http://127.0.0.1:47731/callback',
      pkce: {
        verifier: 'verifier-value',
        challenge: 'challenge-value',
        state: 'state-value',
        nonce: 'nonce-value',
      },
      now: new Date('2026-06-22T08:00:00.000Z'),
      exchangeCode: async (code, verifier) => {
        expect(code).toBe('auth-code')
        expect(verifier).toBe('verifier-value')
        return { token_type: 'Bearer', expires_in: 1800, access_token: 'access-token' }
      },
      fetchAccount: async (accessToken) => {
        expect(accessToken).toBe('access-token')
        return {
          account: {
            account: { sub: 'user-001', preferred_username: 'zhangsan', display_name: '张三' },
            roles: [{ roleCode: 'operator', roleName: '运营' }],
          },
        }
      },
    })

    expect(session.isAuthenticated).toBe(true)
    expect(session.provider).toBe('gravity-sso')
    expect(session.user?.id).toBe('user-001')
    expect(session.roles).toEqual([{ code: 'operator', name: '运营', source: '' }])
    expect(session.expiresAt).toBe('2026-06-22T08:30:00.000Z')
  })

  test('Given state 不匹配 When 完成 SSO 回调 Then 拒绝登录', async () => {
    await expect(completeSsoCallback({
      requestUrl: new URL('http://127.0.0.1:47731/callback?code=auth-code&state=bad-state'),
      redirectUri: 'http://127.0.0.1:47731/callback',
      pkce: {
        verifier: 'verifier-value',
        challenge: 'challenge-value',
        state: 'state-value',
        nonce: 'nonce-value',
      },
      exchangeCode: async () => ({ access_token: 'access-token' }),
      fetchAccount: async () => ({}),
    })).rejects.toThrow('无效的 SSO 回调状态')
  })

  test('Given 环境变量 When 读取默认配置 Then 覆盖 Gravity SSO 参数', () => {
    const config = getDefaultSsoOidcConfig({
      GRAVITY_SSO_ISSUER: 'https://sso.example.com',
      GRAVITY_PC_CLIENT_ID: 'custom-client',
      GRAVITY_PC_REDIRECT_URI: 'http://127.0.0.1:48888/callback',
      GRAVITY_PC_SCOPE: 'openid profile',
    })

    expect(config).toEqual({
      ssoIssuer: 'https://sso.example.com',
      clientId: 'custom-client',
      redirectUri: 'http://127.0.0.1:48888/callback',
      scope: 'openid profile',
    })
  })

  test('Given API 环境变量 When 读取内部认证配置 Then 使用 API_BASE_URL 和自定义路径', () => {
    const config = getDefaultInternalAuthConfig({
      API_BASE_URL: 'https://api.example.com///',
      GRAVITY_CREATE_USER_PATH: 'create_user',
      GRAVITY_SSO_LOGIN_PATH: '/sso_login',
    })

    expect(config).toEqual({
      apiBaseUrl: 'https://api.example.com',
      createUserPath: '/create_user',
      loginPath: '/sso_login',
    })
  })

  test('Given SSO 账号未初始化 When 请求内部认证 Then 调用 create_user 并返回 JWT', async () => {
    const calls: Array<{ url: string, body: unknown }> = []
    const fetchImpl = async (...args: Parameters<typeof fetch>): Promise<Response> => {
      const [url, init] = args
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? '{}')) as unknown,
      })
      return new Response(JSON.stringify({
        token: 'internal-jwt',
        user: { id: 'user-001', username: 'zhangsan', displayName: '张三' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await requestInternalAuthToken({
      apiBaseUrl: 'https://api.example.com',
      createUserPath: '/create_user',
      loginPath: '/sso_login',
    }, {
      userInitial: false,
      tokenSet: { access_token: 'sso-token', id_token: 'id-token' },
      account: { account: { user_initial: false } },
      session: {
        isAuthenticated: true,
        provider: 'gravity-sso',
        user: { id: 'user-001', username: 'zhangsan', displayName: '张三' },
      },
    }, Object.assign(fetchImpl, { preconnect: fetch.preconnect }))

    expect(result.apiToken).toBe('internal-jwt')
    expect(calls[0]?.url).toBe('https://api.example.com/create_user')
    expect(calls[0]?.body).toMatchObject({
      action: 'create_user',
      userInitial: false,
      accessToken: 'sso-token',
    })
  })

  test('Given SSO 账号已初始化 When 完成 callback Then 换取内部 JWT 并保存到会话', async () => {
    const session = await completeSsoCallback({
      requestUrl: new URL('http://127.0.0.1:47731/callback?code=auth-code&state=state-value'),
      redirectUri: 'http://127.0.0.1:47731/callback',
      pkce: {
        verifier: 'verifier-value',
        challenge: 'challenge-value',
        state: 'state-value',
        nonce: 'nonce-value',
      },
      exchangeCode: async () => ({ token_type: 'Bearer', expires_in: 1800, access_token: 'access-token' }),
      fetchAccount: async () => ({
        account: {
          account: {
            sub: 'user-001',
            preferred_username: 'zhangsan',
            display_name: '张三',
            user_initial: true,
          },
        },
      }),
      issueInternalToken: async (input) => {
        expect(input.userInitial).toBe(true)
        return { apiToken: 'internal-jwt' }
      },
    })

    expect(session.apiToken).toBe('internal-jwt')
    expect(session.user?.username).toBe('zhangsan')
  })
})
