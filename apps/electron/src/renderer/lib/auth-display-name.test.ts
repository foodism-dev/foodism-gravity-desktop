import { describe, expect, test } from 'bun:test'

import { getAuthDisplayName } from './auth-display-name'

describe('auth display name', () => {
  test('Given SSO 用户名是技术标识 When 有展示名 Then 优先显示展示名', () => {
    expect(getAuthDisplayName({
      authUser: {
        id: 'user-1',
        username: 'dt_17786376760215570',
        displayName: '张三',
      },
      fallbackName: '用户',
    })).toBe('张三')
  })

  test('Given 没有展示名 When 有用户名 Then 回退显示用户名', () => {
    expect(getAuthDisplayName({
      authUser: {
        id: 'user-1',
        username: 'zhangsan',
        displayName: '',
      },
      fallbackName: '用户',
    })).toBe('zhangsan')
  })

  test('Given 没有登录用户 When 有本地档案名 Then 显示本地档案名', () => {
    expect(getAuthDisplayName({
      fallbackName: '本地用户',
    })).toBe('本地用户')
  })
})
