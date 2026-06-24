/**
 * Gravity SSO OIDC 服务
 *
 * 负责 PC 端 Authorization Code + PKCE 登录流程中的协议细节。
 */

import { createHash, randomBytes } from 'node:crypto'
import http from 'node:http'
import { createAuthSessionFromGravityAccount } from '../auth-service'
import type { AuthSession, AuthUser } from '../../../types'

export interface SsoOidcConfig {
  ssoIssuer: string
  clientId: string
  redirectUri: string
  scope: string
}

export interface PKCEState {
  verifier: string
  challenge: string
  state: string
  nonce: string
}

export type RandomBytesProvider = (size: number) => Buffer

export interface SsoTokenSet {
  token_type?: string
  expires_in?: number
  access_token?: string
  refresh_token?: string
  id_token?: string
}

export interface SsoLoginResult {
  ok: true
  authorizeUrl: string
}

export interface InternalAuthConfig {
  apiBaseUrl: string
  createUserPath: string
  loginPath: string
}

export interface InternalAuthInput {
  tokenSet: SsoTokenSet
  account: unknown
  session: AuthSession
  userInitial: boolean
}

export interface InternalAuthResult {
  apiToken: string
  user?: AuthUser
}

export interface CompleteSsoCallbackInput {
  requestUrl: URL
  redirectUri: string
  pkce: PKCEState
  now?: Date
  exchangeCode: (code: string, verifier: string) => Promise<SsoTokenSet>
  fetchAccount: (accessToken: string) => Promise<unknown>
  issueInternalToken?: (input: InternalAuthInput) => Promise<InternalAuthResult>
}

export interface CreateSsoOidcServiceOptions {
  config: SsoOidcConfig
  openExternal: (url: string) => Promise<unknown>
  saveSession: (session: AuthSession) => AuthSession
  onCompleted?: (session: AuthSession) => void
  onError?: (message: string) => void
  fetchImpl?: typeof fetch
}

export interface SsoOidcService {
  startLogin: () => Promise<SsoLoginResult>
  stopCallbackServer: () => void
}

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function createPKCEState(randomProvider: RandomBytesProvider = randomBytes): PKCEState {
  const verifier = base64url(randomProvider(48))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return {
    verifier,
    challenge,
    state: base64url(randomProvider(24)),
    nonce: base64url(randomProvider(24)),
  }
}

export function getDefaultSsoOidcConfig(env: Record<string, string | undefined> = process.env): SsoOidcConfig {
  return {
    ssoIssuer: env.GRAVITY_SSO_ISSUER || 'https://fawos.online',
    clientId: env.GRAVITY_PC_CLIENT_ID || 'gravity-pc',
    redirectUri: env.GRAVITY_PC_REDIRECT_URI || 'http://127.0.0.1:47731/callback',
    scope: env.GRAVITY_PC_SCOPE || 'openid profile email offline_access',
  }
}

export function getDefaultInternalAuthConfig(env: Record<string, string | undefined> = process.env): InternalAuthConfig {
  return {
    apiBaseUrl: normalizeBaseUrl(requireApiBaseUrl(env.VITE_API_BASE_URL)),
    createUserPath: normalizePath(env.GRAVITY_CREATE_USER_PATH || '/create_user'),
    loginPath: normalizePath(env.GRAVITY_SSO_LOGIN_PATH || '/sso_login'),
  }
}

export function buildAuthorizeUrl(config: SsoOidcConfig, pkce: PKCEState): URL {
  const authorizeUrl = new URL('/oauth2/authorize', config.ssoIssuer)
  authorizeUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    state: pkce.state,
    nonce: pkce.nonce,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    login_hint: 'dingtalk',
  }).toString()
  return authorizeUrl
}

export async function completeSsoCallback(input: CompleteSsoCallbackInput): Promise<AuthSession> {
  const redirect = new URL(input.redirectUri)
  if (input.requestUrl.pathname !== redirect.pathname) {
    throw new Error('无效的 SSO 回调路径')
  }

  const code = input.requestUrl.searchParams.get('code')
  const state = input.requestUrl.searchParams.get('state')
  if (!code || !state || state !== input.pkce.state) {
    throw new Error('无效的 SSO 回调状态')
  }

  const tokenSet = await input.exchangeCode(code, input.pkce.verifier)
  if (!tokenSet.access_token) {
    throw new Error('SSO token 响应缺少 access_token')
  }

  const account = await input.fetchAccount(tokenSet.access_token)
  logSsoUserInfo(account)
  const session = createAuthSessionFromGravityAccount(tokenSet, account, input.now)
  const userInitial = hasUserInitial(account)
  console.log('[SSO] 解析后的用户会话摘要:', stringifyForLog({
    userInitial,
    user: session.user,
    roles: session.roles ?? [],
    identities: session.identities ?? [],
    expiresAt: session.expiresAt,
    refreshable: session.refreshable,
  }))
  if (!input.issueInternalToken) {
    return session
  }

  const internalAuth = await input.issueInternalToken({
    tokenSet,
    account,
    session,
    userInitial,
  })
  return {
    ...session,
    apiToken: internalAuth.apiToken,
    user: internalAuth.user ?? session.user,
  }
}

export function createSsoOidcService(options: CreateSsoOidcServiceOptions): SsoOidcService {
  let callbackServer: http.Server | null = null
  let currentPkce: PKCEState | null = null
  const fetchImpl = options.fetchImpl ?? fetch

  function stopCallbackServer(): void {
    if (!callbackServer) return
    callbackServer.close()
    callbackServer = null
  }

  async function exchangeCode(code: string, verifier: string): Promise<SsoTokenSet> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: options.config.clientId,
      code,
      redirect_uri: options.config.redirectUri,
      code_verifier: verifier,
    })
    const response = await fetchImpl(new URL('/oauth2/token', options.config.ssoIssuer), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const payload = await parseJsonResponse(response)
    if (!response.ok) {
      throw new Error(getResponseError(payload, `SSO token 请求失败: ${response.status}`))
    }
    return toTokenSet(payload)
  }

  async function fetchAccount(accessToken: string): Promise<unknown> {
    const response = await fetchImpl(new URL('/oauth2/account', options.config.ssoIssuer), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const payload = await parseJsonResponse(response)
    if (!response.ok) {
      throw new Error(getResponseError(payload, `SSO account 请求失败: ${response.status}`))
    }
    return payload
  }

  async function issueInternalToken(input: InternalAuthInput): Promise<InternalAuthResult> {
    return requestInternalAuthToken(getDefaultInternalAuthConfig(), input, fetchImpl)
  }

  function startCallbackServer(): Promise<void> {
    if (callbackServer) return Promise.resolve()
    const redirect = new URL(options.config.redirectUri)

    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        try {
          if (!req.url || !currentPkce) {
            throw new Error('SSO 登录状态不存在，请重新发起登录')
          }
          const requestUrl = new URL(req.url, options.config.redirectUri)
          const session = await completeSsoCallback({
            requestUrl,
            redirectUri: options.config.redirectUri,
            pkce: currentPkce,
            exchangeCode,
            fetchAccount,
            issueInternalToken,
          })
          options.saveSession(session)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          currentPkce = null
          res.end(renderCallbackSuccess(session), () => {
            options.onCompleted?.(session)
            stopCallbackServer()
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'SSO 登录失败'
          options.onError?.(message)
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(message)
        }
      })

      server.once('error', (error) => {
        callbackServer = null
        reject(error)
      })
      server.listen(Number(redirect.port || 47731), redirect.hostname, () => {
        callbackServer = server
        resolve()
      })
    })
  }

  return {
    async startLogin(): Promise<SsoLoginResult> {
      currentPkce = createPKCEState()
      await startCallbackServer()
      const authorizeUrl = buildAuthorizeUrl(options.config, currentPkce)
      await options.openExternal(authorizeUrl.toString())
      return { ok: true, authorizeUrl: authorizeUrl.toString() }
    },
    stopCallbackServer,
  }
}

export async function requestInternalAuthToken(
  config: InternalAuthConfig,
  input: InternalAuthInput,
  fetchImpl: typeof fetch = fetch
): Promise<InternalAuthResult> {
  const endpoint = input.userInitial ? config.loginPath : config.createUserPath
  const response = await fetchImpl(new URL(endpoint, `${config.apiBaseUrl}/`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildInternalAuthPayload(input)),
  })
  const payload = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(getResponseError(payload, `内部认证请求失败: ${response.status}`))
  }
  return toInternalAuthResult(payload)
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

function getResponseError(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null) {
    const data = payload as Record<string, unknown>
    if (typeof data.message === 'string' && data.message) return data.message
    if (typeof data.error === 'string' && data.error) return data.error
  }
  return fallback
}

function toTokenSet(payload: unknown): SsoTokenSet {
  if (typeof payload !== 'object' || payload === null) return {}
  const data = payload as Record<string, unknown>
  return {
    token_type: typeof data.token_type === 'string' ? data.token_type : undefined,
    expires_in: typeof data.expires_in === 'number' ? data.expires_in : undefined,
    access_token: typeof data.access_token === 'string' ? data.access_token : undefined,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    id_token: typeof data.id_token === 'string' ? data.id_token : undefined,
  }
}

function stringifyForLog(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function logSsoUserInfo(account: unknown): void {
  console.log('[SSO] userinfo/account 原始响应:', stringifyForLog(account))
  if (isRecord(account)) {
    console.log('[SSO] userinfo/account 顶层字段:', Object.keys(account).join(', ') || '<empty>')
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function requireApiBaseUrl(value: string | undefined): string {
  const baseUrl = value?.trim()
  if (!baseUrl) {
    throw new Error('缺少 VITE_API_BASE_URL 配置，无法请求 Gravity API')
  }
  return baseUrl
}

function normalizePath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '/'
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickRecord(value: unknown, keys: string[]): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  for (const key of keys) {
    const nested = value[key]
    if (isRecord(nested)) return nested
  }
  return undefined
}

function pickString(value: unknown, keys: string[]): string {
  if (!isRecord(value)) return ''
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return ''
}

function pickBoolean(value: unknown, keys: string[]): boolean | undefined {
  if (!isRecord(value)) return undefined
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'boolean') return candidate
  }
  return undefined
}

function hasUserInitial(rawAccount: unknown): boolean {
  const keys = [
    'userInitial',
    'user_initial',
    'isUserInitial',
    'is_user_initial',
    'userInitialized',
    'user_initialized',
    'hasUser',
    'has_user',
    'hasInternalUser',
    'has_internal_user',
    'initial',
    'isInitial',
    'is_initial',
    'initialized',
  ]
  const candidates = [
    rawAccount,
    pickRecord(rawAccount, ['account']),
    pickRecord(pickRecord(rawAccount, ['account']), ['account']),
    pickRecord(rawAccount, ['user']),
    pickRecord(rawAccount, ['internalUser', 'internal_user']),
  ]

  for (const candidate of candidates) {
    const matched = pickBoolean(candidate, keys)
    if (typeof matched === 'boolean') return matched
  }

  // SSO 侧没有下发明确标记时，按已初始化处理，避免重复创建用户。
  return true
}

function buildInternalAuthPayload(input: InternalAuthInput): Record<string, unknown> {
  return {
    provider: 'gravity-sso',
    action: input.userInitial ? 'login' : 'create_user',
    userInitial: input.userInitial,
    accessToken: input.tokenSet.access_token,
    refreshToken: input.tokenSet.refresh_token,
    idToken: input.tokenSet.id_token,
    tokenType: input.tokenSet.token_type,
    expiresIn: input.tokenSet.expires_in,
    account: input.account,
    user: input.session.user,
    roles: input.session.roles ?? [],
    identities: input.session.identities ?? [],
  }
}

function toAuthUser(value: unknown): AuthUser | undefined {
  const id = pickString(value, ['id', 'sub', 'user_id', 'userId'])
  const username = pickString(value, ['username', 'preferred_username'])
  const displayName = pickString(value, ['displayName', 'display_name', 'name', 'username'])
  if (!id || !username || !displayName) return undefined

  const user: AuthUser = { id, username, displayName }
  const email = pickString(value, ['email'])
  const phoneMasked = pickString(value, ['phoneMasked', 'phone_masked'])
  const tenantId = pickString(value, ['tenantId', 'tenant_id'])
  const employeeNo = pickString(value, ['employeeNo', 'employee_no'])
  const title = pickString(value, ['title'])
  if (email) user.email = email
  if (phoneMasked) user.phoneMasked = phoneMasked
  if (tenantId) user.tenantId = tenantId
  if (employeeNo) user.employeeNo = employeeNo
  if (title) user.title = title
  return user
}

function toInternalAuthResult(payload: unknown): InternalAuthResult {
  if (!isRecord(payload)) {
    throw new Error('内部认证响应格式无效')
  }
  const apiToken = pickString(payload, ['token', 'jwt', 'apiToken', 'api_token', 'accessToken', 'access_token'])
  if (!apiToken) {
    throw new Error('内部认证响应缺少 JWT token')
  }
  return {
    apiToken,
    user: toAuthUser(payload.user),
  }
}

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch))
}

function renderCallbackSuccess(session: AuthSession): string {
  const name = escapeHTML(session.user?.displayName || session.user?.username || 'Gravity 用户')
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Gravity PC 登录完成</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0f172a; background: #f7fbf9; }
    main { width: min(640px, calc(100vw - 40px)); padding: 42px; border-radius: 24px; background: white; box-shadow: 0 28px 90px rgba(15, 23, 42, .12); text-align: center; }
    .check { width: 76px; height: 76px; margin: 0 auto 22px; border-radius: 50%; display: grid; place-items: center; background: #effaf5; color: #00a870; font-size: 42px; font-weight: 900; }
    h1 { margin: 0; font-size: 34px; }
    p { margin: 14px auto 0; max-width: 480px; color: #64748b; line-height: 1.7; }
  </style>
</head>
<body>
  <main>
    <div class="check">✓</div>
    <h1>登录完成</h1>
    <p>${name} 已通过 Gravity SSO 校验。你可以关闭这个授权窗口，回到万店引力桌面端继续操作。</p>
  </main>
</body>
</html>`
}
