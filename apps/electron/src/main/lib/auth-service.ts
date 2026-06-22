/**
 * 登录服务
 *
 * 当前保留固定账号 admin / foodism123 作为开发兜底，同时支持 Gravity SSO
 * 登录会话的归一化和本地持久化。
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { getAuthSessionPath } from './config-paths'
import type { AuthIdentity, AuthRole, AuthSession, AuthUser, LoginInput } from '../../types'

const MOCK_USERNAME = 'admin'
const MOCK_PASSWORD = 'foodism123'

export interface AuthService {
  getAuthSession: () => AuthSession
  saveSession: (session: AuthSession) => AuthSession
  login: (input: LoginInput) => Promise<AuthSession>
  logout: () => AuthSession
}

const LOGGED_OUT_SESSION: AuthSession = { isAuthenticated: false }

interface GravityTokenSet {
  token_type?: string
  expires_in?: number
  refresh_token?: string
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toNumberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function parseUser(value: unknown): AuthUser | undefined {
  const data = toRecord(value)
  if (!data) return undefined

  const id = toStringValue(data.id)
  const username = toStringValue(data.username)
  const displayName = toStringValue(data.displayName)
  if (!id || !username || !displayName) return undefined

  const user: AuthUser = {
    id,
    username,
    displayName,
  }
  const email = toStringValue(data.email)
  const phoneMasked = toStringValue(data.phoneMasked)
  const tenantId = toStringValue(data.tenantId)
  const employeeNo = toStringValue(data.employeeNo)
  const title = toStringValue(data.title)
  if (email) user.email = email
  if (phoneMasked) user.phoneMasked = phoneMasked
  if (tenantId) user.tenantId = tenantId
  if (employeeNo) user.employeeNo = employeeNo
  if (title) user.title = title
  return user
}

function parseRole(value: unknown): AuthRole | null {
  const data = toRecord(value)
  if (!data) return null
  return {
    code: toStringValue(data.code),
    name: toStringValue(data.name),
    source: toStringValue(data.source),
  }
}

function parseIdentity(value: unknown): AuthIdentity | null {
  const data = toRecord(value)
  if (!data) return null
  return {
    provider: toStringValue(data.provider),
    type: toStringValue(data.type),
    status: toStringValue(data.status),
    externalKey: toStringValue(data.externalKey),
    phoneMasked: toStringValue(data.phoneMasked),
  }
}

function isExpired(expiresAt: string): boolean {
  const timestamp = Date.parse(expiresAt)
  return Number.isFinite(timestamp) && timestamp <= Date.now()
}

function parseStoredSession(raw: string): AuthSession {
  const data = toRecord(JSON.parse(raw))
  if (!data || data.isAuthenticated !== true) {
    return LOGGED_OUT_SESSION
  }

  const user = parseUser(data.user)
  if (!user) return LOGGED_OUT_SESSION
  const roles = toArray(data.roles).map(parseRole).filter((role): role is AuthRole => role !== null)
  const identities = toArray(data.identities).map(parseIdentity).filter((identity): identity is AuthIdentity => identity !== null)
  const session: AuthSession = {
    isAuthenticated: true,
    provider: data.provider === 'gravity-sso' ? 'gravity-sso' : 'mock',
    user,
    loggedInAt: toStringValue(data.loggedInAt) || new Date().toISOString(),
  }

  if (roles.length > 0) session.roles = roles
  if (identities.length > 0) session.identities = identities
  const expiresAt = toStringValue(data.expiresAt)
  if (data.provider === 'gravity-sso' && expiresAt && isExpired(expiresAt)) {
    return LOGGED_OUT_SESSION
  }
  if (expiresAt) session.expiresAt = expiresAt
  if (typeof data.refreshable === 'boolean') session.refreshable = data.refreshable
  return session
}

function maskMobile(value: unknown): string {
  const text = toStringValue(value).replace(/\D/g, '')
  if (text.length < 7) return text
  return `${text.slice(0, 3)}****${text.slice(-4)}`
}

function pickString(record: JsonRecord | undefined, keys: string[]): string {
  if (!record) return ''
  for (const key of keys) {
    const value = toStringValue(record[key])
    if (value) return value
  }
  return ''
}

function extractAccountBlocks(rawAccount: unknown): {
  account: JsonRecord
  identities: unknown[]
  roles: unknown[]
} {
  const raw = toRecord(rawAccount) ?? {}
  const accountContainer = toRecord(raw.account) ?? raw
  const account = toRecord(accountContainer.account) ?? accountContainer
  const identities = toArray(accountContainer.identities).length > 0
    ? toArray(accountContainer.identities)
    : toArray(raw.identities)
  const roles = toArray(accountContainer.roles).length > 0
    ? toArray(accountContainer.roles)
    : toArray(raw.roles)

  return { account, identities, roles }
}

export function createAuthSessionFromGravityAccount(
  tokenSet: GravityTokenSet,
  rawAccount: unknown,
  now: Date = new Date()
): AuthSession {
  const { account, identities, roles } = extractAccountBlocks(rawAccount)
  const dingtalkIdentity = identities
    .map(toRecord)
    .find((identity) => identity?.provider === 'dingtalk')
  const metadata = toRecord(dingtalkIdentity?.metadata)
  const expiresIn = toNumberValue(tokenSet.expires_in)
  const expiresAt = expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000).toISOString() : undefined

  return {
    isAuthenticated: true,
    provider: 'gravity-sso',
    user: {
      id: pickString(account, ['sub', 'user_id', 'userId']),
      username: pickString(account, ['preferred_username', 'username']),
      displayName: pickString(account, ['display_name', 'displayName', 'name', 'username']),
      email: pickString(account, ['email']) || undefined,
      phoneMasked: maskMobile(dingtalkIdentity?.phone ?? metadata?.mobile) || undefined,
      tenantId: pickString(account, ['tenant_id', 'tenantId']) || 'foodism',
      employeeNo: pickString(metadata, ['employeeNo', 'jobNumber', 'workNo']) || pickString(dingtalkIdentity, ['externalKey']),
      title: pickString(metadata, ['title', 'position']) || undefined,
    },
    roles: roles.map((role): AuthRole => {
      const data = toRecord(role) ?? {}
      return {
        code: pickString(data, ['roleCode', 'role_code']),
        name: pickString(data, ['roleName', 'role_name', 'roleCode']),
        source: pickString(data, ['sourceType', 'source_type']),
      }
    }),
    identities: identities.map((identity): AuthIdentity => {
      const data = toRecord(identity) ?? {}
      const identityMetadata = toRecord(data.metadata)
      return {
        provider: pickString(data, ['provider']),
        type: pickString(data, ['identityType', 'identity_type']),
        status: pickString(data, ['status']),
        externalKey: pickString(data, ['externalKey', 'external_key']),
        phoneMasked: maskMobile(data.phone ?? identityMetadata?.mobile ?? identityMetadata?.rawMobile),
      }
    }),
    loggedInAt: now.toISOString(),
    expiresAt,
    refreshable: Boolean(tokenSet.refresh_token),
  }
}

export function createAuthService(sessionPath: string): AuthService {
  return {
    getAuthSession(): AuthSession {
      if (!existsSync(sessionPath)) {
        return LOGGED_OUT_SESSION
      }

      try {
        return parseStoredSession(readFileSync(sessionPath, 'utf-8'))
      } catch (error) {
        console.error('[登录] 读取会话失败:', error)
        return LOGGED_OUT_SESSION
      }
    },

    saveSession(session: AuthSession): AuthSession {
      try {
        writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8')
        console.log(`[登录] 会话已保存: ${session.user?.username ?? '<unknown>'}`)
      } catch (error) {
        console.error('[登录] 写入会话失败:', error)
        throw new Error('保存登录状态失败')
      }
      return session
    },

    async login(input: LoginInput): Promise<AuthSession> {
      const username = input.username.trim()
      if (username !== MOCK_USERNAME || input.password !== MOCK_PASSWORD) {
        console.warn(`[登录] mock 认证失败: ${username || '<empty>'}`)
        throw new Error('账号或密码错误')
      }

      const user = {
        id: MOCK_USERNAME,
        username: MOCK_USERNAME,
        displayName: '管理员',
      }
      const session: AuthSession = {
        isAuthenticated: true,
        provider: 'mock',
        user,
        loggedInAt: new Date().toISOString(),
      }

      try {
        this.saveSession(session)
        console.log(`[登录] mock 用户已登录: ${user.username}`)
      } catch (error) {
        console.error('[登录] 写入会话失败:', error)
        throw new Error('保存登录状态失败')
      }

      return session
    },

    logout(): AuthSession {
      try {
        rmSync(sessionPath, { force: true })
        console.log('[登录] 已退出登录')
      } catch (error) {
        console.error('[登录] 清理会话失败:', error)
        throw new Error('退出登录失败')
      }
      return LOGGED_OUT_SESSION
    },
  }
}

let defaultAuthService: AuthService | null = null

function getDefaultAuthService(): AuthService {
  defaultAuthService ??= createAuthService(getAuthSessionPath())
  return defaultAuthService
}

export function getAuthSession(): AuthSession {
  return getDefaultAuthService().getAuthSession()
}

export function login(input: LoginInput): Promise<AuthSession> {
  return getDefaultAuthService().login(input)
}

export function saveAuthSession(session: AuthSession): AuthSession {
  return getDefaultAuthService().saveSession(session)
}

export function logout(): AuthSession {
  return getDefaultAuthService().logout()
}
