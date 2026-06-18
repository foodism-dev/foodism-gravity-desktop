import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test } from 'bun:test'
import { getSettings } from './settings-service'

const tempDirs: string[] = []

function useTempConfigDir(): void {
  const dir = mkdtempSync(join(tmpdir(), 'foodism-settings-test-'))
  tempDirs.push(dir)
  process.env.FOODISM_GRAVITY_CONFIG_DIR = dir
  process.env.FOODISM_DEFAULT_RELAY_API_KEY = ''
  process.env.FOODISM_DEFAULT_PROVIDER_API_KEY = ''
  process.env.FOODISM_DEFAULT_DEEPSEEK_API_KEY = ''
  process.env.DEEPSEEK_API_KEY = ''
  process.env.ANTHROPIC_API_KEY = ''
}

afterEach(() => {
  delete process.env.FOODISM_GRAVITY_CONFIG_DIR
  delete process.env.FOODISM_DEFAULT_RELAY_API_KEY
  delete process.env.FOODISM_DEFAULT_PROVIDER_API_KEY
  delete process.env.FOODISM_DEFAULT_DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.ANTHROPIC_API_KEY

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('应用设置默认外观', () => {
  test('Given 设置文件不存在 When 读取设置 Then 默认选择森息晨光', () => {
    useTempConfigDir()

    const settings = getSettings()

    expect(settings.themeMode).toBe('special')
    expect(settings.themeStyle).toBe('forest-light')
  })
})
