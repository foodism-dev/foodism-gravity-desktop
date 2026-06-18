import { describe, expect, test } from 'bun:test'
import { getBuiltinInstallerManifest } from './installer-manifest'

describe('Windows 安装包清单', () => {
  test('Given 内置 fallback 清单 When 查找 Git for Windows Then 使用当前维护版本', () => {
    const manifest = getBuiltinInstallerManifest()
    const gitInstallers = manifest.installers.filter((item) => item.id === 'git-for-windows')

    expect(gitInstallers).toHaveLength(2)
    expect(gitInstallers.map((item) => item.arch).sort()).toEqual(['arm64', 'x64'])

    for (const installer of gitInstallers) {
      expect(installer.version).toBe('2.54.0')
      expect(installer.fallbackUrl).toContain('v2.54.0.windows.1')
      expect(installer.filename).toContain('2.54.0')
    }
  })
})
