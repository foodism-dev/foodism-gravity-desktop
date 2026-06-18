import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const appDir = join(import.meta.dir, '../../..')

describe('Windows NSIS 安装器配置', () => {
  test('Given Windows 构建配置 When 打包 NSIS Then 加载 Git Bash 安装脚本', () => {
    const config = readFileSync(join(appDir, 'electron-builder.yml'), 'utf8')

    expect(config).toContain('include: resources/installer/windows-gitbash.nsh')
  })

  test('Given Git Bash 安装脚本 When 安装器执行 Then 能检测并拉起 Git for Windows', () => {
    const script = readFileSync(
      join(appDir, 'resources/installer/windows-gitbash.nsh'),
      'utf8',
    )

    expect(script).toContain('!ifndef BUILD_UNINSTALLER')
    expect(script).toContain('!endif # BUILD_UNINSTALLER')
    expect(script).toContain('DetectGitBash')
    expect(script).toContain('Git-2.54.0-64-bit.exe')
    expect(script).toContain('/VERYSILENT')
    expect(script).toContain('Windows 上未检测到 Git Bash')
  })
})
