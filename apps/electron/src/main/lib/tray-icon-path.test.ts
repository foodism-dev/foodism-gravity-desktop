import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { resolveTrayIconPath } from './tray-icon-path'

describe('macOS 菜单栏图标资源', () => {
  test('Given 彩色 logo 存在 When 解析托盘图标 Then 优先使用 logo 资源', () => {
    const resourcesDir = '/tmp/resources'
    const existing = new Set([join(resourcesDir, 'proma-logos', 'tray-logo.png')])

    const iconPath = resolveTrayIconPath(resourcesDir, (path) => existing.has(path))

    expect(iconPath).toBe(join(resourcesDir, 'proma-logos', 'tray-logo.png'))
  })

  test('Given 彩色 logo 缺失 When 解析托盘图标 Then 回退到旧 Template 资源', () => {
    const resourcesDir = '/tmp/resources'
    const existing = new Set([join(resourcesDir, 'proma-logos', 'iconTemplate.png')])

    const iconPath = resolveTrayIconPath(resourcesDir, (path) => existing.has(path))

    expect(iconPath).toBe(join(resourcesDir, 'proma-logos', 'iconTemplate.png'))
  })
})
