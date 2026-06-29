import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test } from 'bun:test'
import { createAuthService, createAuthSessionFromGravityAccount } from './auth-service'
import type { AuthSession } from '../../types'

const tempDirs: string[] = []

function createTempAuthPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'proma-auth-test-'))
  tempDirs.push(dir)
  return join(dir, 'auth-session.json')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('auth-service 登录会话', () => {
  test('Given 没有会话文件 When 获取登录状态 Then 返回未登录', () => {
    const service = createAuthService(createTempAuthPath())

    expect(service.getAuthSession()).toEqual({ isAuthenticated: false })
  })

  test('Given mock 账号正确 When 登录 Then 返回已登录会话并持久化', async () => {
    const path = createTempAuthPath()
    const service = createAuthService(path)

    const session = await service.login({ username: 'admin', password: 'foodism123' })

    expect(session.isAuthenticated).toBe(true)
    expect(session.user?.username).toBe('admin')
    expect(session.user?.displayName).toBe('管理员')
    expect(service.getAuthSession()).toEqual(session)
  })

  test('Given mock 账号错误 When 登录 Then 抛出认证失败错误且不落盘', async () => {
    const service = createAuthService(createTempAuthPath())

    await expect(service.login({ username: 'admin', password: 'wrong-password' })).rejects.toThrow('账号或密码错误')
    expect(service.getAuthSession()).toEqual({ isAuthenticated: false })
  })

  test('Given 已登录 When 退出登录 Then 清空本地会话', async () => {
    const service = createAuthService(createTempAuthPath())
    await service.login({ username: 'admin', password: 'foodism123' })

    const session = service.logout()

    expect(session).toEqual({ isAuthenticated: false })
    expect(service.getAuthSession()).toEqual({ isAuthenticated: false })
  })

  test('Given SSO 会话已落盘 When 获取登录状态 Then 保留用户、角色、JWT 和 OIDC token', () => {
    const path = createTempAuthPath()
    const service = createAuthService(path)
    const session: AuthSession = {
      isAuthenticated: true,
      provider: 'gravity-sso',
      apiToken: 'api-jwt-token',
      accessToken: 'oidc-access-token',
      refreshToken: 'oidc-refresh-token',
      idToken: 'oidc-id-token',
      tokenType: 'Bearer',
      user: {
        id: 'user-001',
        username: 'zhangsan',
        displayName: '张三',
        email: 'zhangsan@example.com',
        phoneMasked: '138****8000',
      },
      roles: [{ code: 'store-admin', name: '门店管理员', source: 'gravity' }],
      identities: [{ provider: 'dingtalk', type: 'oauth', status: 'active', externalKey: 'dt-001', phoneMasked: '138****8000' }],
      loggedInAt: '2026-06-22T08:00:00.000Z',
      expiresAt: '2099-06-22T10:00:00.000Z',
      refreshable: true,
    }

    writeFileSync(path, JSON.stringify(session, null, 2), 'utf-8')

    expect(service.getAuthSession()).toEqual(session)
  })

  test('Given SSO 会话已过期 When 获取登录状态 Then 返回未登录', () => {
    const path = createTempAuthPath()
    const service = createAuthService(path)
    const session: AuthSession = {
      isAuthenticated: true,
      provider: 'gravity-sso',
      user: {
        id: 'user-001',
        username: 'zhangsan',
        displayName: '张三',
      },
      loggedInAt: '2026-06-22T08:00:00.000Z',
      expiresAt: '2000-01-01T00:00:00.000Z',
    }

    writeFileSync(path, JSON.stringify(session, null, 2), 'utf-8')

    expect(service.getAuthSession()).toEqual({ isAuthenticated: false })
  })

  test('Given SSO 会话已过期但可刷新 When 获取登录状态 Then 保留会话用于渲染进程刷新恢复', () => {
    const path = createTempAuthPath()
    const service = createAuthService(path)
    const session: AuthSession = {
      isAuthenticated: true,
      provider: 'gravity-sso',
      apiToken: 'api-jwt-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'user-001',
        username: 'zhangsan',
        displayName: '张三',
      },
      loggedInAt: '2026-06-22T08:00:00.000Z',
      expiresAt: '2000-01-01T00:00:00.000Z',
      refreshable: true,
    }

    writeFileSync(path, JSON.stringify(session, null, 2), 'utf-8')

    expect(service.getAuthSession()).toEqual(session)
  })

  test('Given SSO 会话 When 保存会话 Then 后续获取返回同一会话', () => {
    const service = createAuthService(createTempAuthPath())
    const session = {
      isAuthenticated: true,
      provider: 'gravity-sso' as const,
      user: {
        id: 'user-001',
        username: 'zhangsan',
        displayName: '张三',
      },
      loggedInAt: '2026-06-22T08:00:00.000Z',
    }

    service.saveSession(session)

    expect(service.getAuthSession()).toEqual(session)
  })

  test('Given Gravity account payload When 创建登录会话 Then 映射用户、角色和身份摘要', () => {
    const session = createAuthSessionFromGravityAccount(
      {
        token_type: 'Bearer',
        access_token: 'oidc-access-token',
        id_token: 'oidc-id-token',
        expires_in: 7200,
        refresh_token: 'refresh-token',
      },
      {
        account: {
          account: {
            sub: 'user-001',
            preferred_username: 'zhangsan',
            display_name: '张三',
            email: 'zhangsan@example.com',
            tenant_id: 'foodism',
          },
          identities: [
            {
              provider: 'dingtalk',
              identityType: 'oauth',
              status: 'active',
              externalKey: 'dt-001',
              phone: '13812348000',
              metadata: {
                employeeNo: 'E-1001',
                title: '店长',
              },
            },
          ],
          roles: [
            {
              roleCode: 'store-admin',
              roleName: '门店管理员',
              sourceType: 'gravity',
            },
          ],
        },
      },
      new Date('2026-06-22T08:00:00.000Z')
    )

    expect(session).toEqual({
      isAuthenticated: true,
      provider: 'gravity-sso',
      accessToken: 'oidc-access-token',
      refreshToken: 'refresh-token',
      idToken: 'oidc-id-token',
      tokenType: 'Bearer',
      user: {
        id: 'user-001',
        username: 'zhangsan',
        displayName: '张三',
        email: 'zhangsan@example.com',
        phoneMasked: '138****8000',
        tenantId: 'foodism',
        employeeNo: 'E-1001',
        title: '店长',
      },
      roles: [{ code: 'store-admin', name: '门店管理员', source: 'gravity' }],
      identities: [{ provider: 'dingtalk', type: 'oauth', status: 'active', externalKey: 'dt-001', phoneMasked: '138****8000' }],
      loggedInAt: '2026-06-22T08:00:00.000Z',
      expiresAt: '2026-06-22T10:00:00.000Z',
      refreshable: true,
    })
  })
})
