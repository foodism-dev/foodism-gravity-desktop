/**
 * Mock 登录服务
 *
 * 当前只校验固定账号 admin / foodism123，并将会话状态保存到本地配置文件。
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { getAuthSessionPath } from './config-paths'
import type { AuthSession, LoginInput } from '../../types'

const MOCK_USERNAME = 'admin'
const MOCK_PASSWORD = 'foodism123'

export interface AuthService {
  getAuthSession: () => AuthSession
  login: (input: LoginInput) => Promise<AuthSession>
  logout: () => AuthSession
}

const LOGGED_OUT_SESSION: AuthSession = { isAuthenticated: false }

function parseStoredSession(raw: string): AuthSession {
  const data = JSON.parse(raw) as Partial<AuthSession>
  if (!data.isAuthenticated || !data.user) {
    return LOGGED_OUT_SESSION
  }
  return {
    isAuthenticated: true,
    user: {
      id: data.user.id || MOCK_USERNAME,
      username: data.user.username || MOCK_USERNAME,
      displayName: data.user.displayName || '管理员',
    },
    loggedInAt: data.loggedInAt || new Date().toISOString(),
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
        user,
        loggedInAt: new Date().toISOString(),
      }

      try {
        writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8')
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

export function logout(): AuthSession {
  return getDefaultAuthService().logout()
}
