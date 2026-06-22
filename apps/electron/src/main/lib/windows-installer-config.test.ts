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
    expect(script).toContain('npmmirror.com/mirrors/git-for-windows/v2.54.0.windows.1')
    expect(script).not.toContain('cdn.proma.cool')
    expect(script).not.toContain('github.com/git-for-windows')
    expect(script).toContain('Git-2.54.0-64-bit.exe')
    expect(script).not.toContain('GIT_FOR_WINDOWS_FALLBACK_URL')
    expect(script).toContain('Get-Command bash.exe')
    expect(script).toContain('wsl.exe --status')
    expect(script).toContain('foodism-gravity-git-install.log')
    expect(script).toContain('foodism-gravity-download-git.ps1')
    expect(script).toContain('WriteGitDownloadScript')
    expect(script).toContain('-File "$GitDownloadScriptPath"')
    expect(script).not.toContain('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$log =')
    expect(script).toContain('Git for Windows 安装日志')
    expect(script).toContain('日志文件：$GitInstallLogPath')
    expect(script).toContain('日志路径：$GitInstallLogPath')
    expect(script).toContain('检查 Git Bash 路径')
    expect(script).toContain('PATH 检测退出码')
    expect(script).toContain('WSL 检测退出码')
    expect(script).toContain('PowerShell 版本')
    expect(script).toContain('操作系统')
    expect(script).toContain('HTTP 状态码')
    expect(script).toContain('下载文件大小')
    expect(script).toContain('异常类型')
    expect(script).toContain('异常消息')
    expect(script).toContain('主下载源下载失败')
    expect(script).not.toContain('备用下载源下载失败')
    expect(script).toContain('/VERYSILENT')
    expect(script).toContain('Windows 上未检测到 Git Bash 或 WSL')
    expect(script).toContain('万店引力运行 Agent')
    expect(script).toContain('安装器未检测到 Git Bash 或 WSL')
  })
})
