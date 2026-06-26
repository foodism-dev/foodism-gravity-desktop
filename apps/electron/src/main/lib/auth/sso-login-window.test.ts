import { describe, expect, test } from 'bun:test'

import { SSO_LOGIN_CLOSE_URL, buildSsoLoginCloseButtonScript, isSsoLoginCloseUrl } from './sso-login-window'

describe('sso-login-window', () => {
  test('Given SSO 关闭地址 When 判断弹窗导航 Then 识别为内部关闭请求', () => {
    expect(isSsoLoginCloseUrl(SSO_LOGIN_CLOSE_URL)).toBe(true)
    expect(isSsoLoginCloseUrl('https://sso.example.com/oauth2/authorize')).toBe(false)
  })

  test('Given SSO 登录页 When 生成注入脚本 Then 包含可访问关闭按钮和关闭跳转', () => {
    const script = buildSsoLoginCloseButtonScript()

    expect(script).toContain('关闭登录窗口')
    expect(script).toContain('关闭')
    expect(script).toContain(SSO_LOGIN_CLOSE_URL)
    expect(script).toContain('proma-sso-close-button')
  })

  test('Given 第三方登录页全局样式 When 注入关闭按钮 Then 使用隔离样式避免被拉伸成横条', () => {
    const script = buildSsoLoginCloseButtonScript()

    expect(script).toContain('all: initial;')
    expect(script).toContain('box-sizing: border-box;')
    expect(script).toContain('width: auto;')
    expect(script).toContain('max-width: 88px;')
  })
})
