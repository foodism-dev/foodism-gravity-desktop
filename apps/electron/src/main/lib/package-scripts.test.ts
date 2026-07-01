import { describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

interface PackageJson {
  scripts: Record<string, string>
}

function isPackageJson(value: unknown): value is PackageJson {
  if (typeof value !== 'object' || value === null) return false
  const scripts = (value as { scripts?: unknown }).scripts
  return typeof scripts === 'object' && scripts !== null && !Array.isArray(scripts)
}

async function readPackageJson(): Promise<PackageJson> {
  const packagePath = join(dirname(fileURLToPath(import.meta.url)), '../../../package.json')
  const parsed = await Bun.file(packagePath).json()
  if (!isPackageJson(parsed)) {
    throw new Error('package.json 缺少 scripts 配置')
  }
  return parsed
}

describe('Electron 本地打包脚本', () => {
  test('Given 本地打包脚本 When 读取 package.json Then 先构建产物再执行 electron-builder', async () => {
    const packageJson = await readPackageJson()
    const scripts = ['pack', 'dist', 'dist:mac', 'dist:win', 'dist:linux']

    for (const scriptName of scripts) {
      expect(packageJson.scripts[scriptName]).toStartWith('bun run build && electron-builder')
    }
  })
})
