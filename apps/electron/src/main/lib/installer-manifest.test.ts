import { describe, expect, test } from 'bun:test'
import {
  getBuiltinInstallerManifest,
  normalizeInstallerManifest,
} from './installer-manifest'

describe('Windows 安装包清单', () => {
  test('Given 内置 fallback 清单 When 查找 Git for Windows Then 使用当前维护版本', () => {
    const manifest = getBuiltinInstallerManifest()
    const gitInstallers = manifest.installers.filter((item) => item.id === 'git-for-windows')

    expect(gitInstallers).toHaveLength(2)
    expect(gitInstallers.map((item) => item.arch).sort()).toEqual(['arm64', 'x64'])

    for (const installer of gitInstallers) {
      expect(installer.version).toBe('2.54.0')
      expect(installer.downloadUrl).toContain('https://npmmirror.com/mirrors/git-for-windows/v2.54.0.windows.1/')
      expect(installer.downloadUrl).not.toContain('github.com/git-for-windows')
      expect(installer.fallbackUrl).toBe('')
      expect(installer.filename).toContain('2.54.0')
      expect(installer.sha256).toHaveLength(64)
    }
  })

  test('Given 远程清单仍返回旧下载源和旧 fallback When 标准化 Then Git 下载源只使用 npmmirror', () => {
    const manifest = normalizeInstallerManifest({
      installers: [
        {
          id: 'git-for-windows',
          platform: 'win32',
          arch: 'x64',
          version: '2.54.0',
          downloadUrl: 'https://legacy.example.com/Git-2.54.0-64-bit.exe',
          fallbackUrl: 'https://legacy.example.com/Git-2.54.0-64-bit.exe',
          sha256: '',
          sizeBytes: 0,
          filename: 'Git-2.54.0-64-bit.exe',
        },
      ],
    })

    const [installer] = manifest.installers
    if (!installer) {
      throw new Error('缺少 Git for Windows 安装包条目')
    }

    expect(installer.downloadUrl).toContain('npmmirror.com')
    expect(installer.downloadUrl).not.toContain('legacy.example.com')
    expect(installer.downloadUrl).not.toContain('github.com/git-for-windows')
    expect(installer.fallbackUrl).toBe('')
    expect(installer.sha256).toHaveLength(64)
    expect(installer.sizeBytes).toBe(65175776)
  })
})
