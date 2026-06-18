import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test } from 'bun:test'
import { createAuthService } from './auth-service'

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

describe('auth-service mock 登录', () => {
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
})
