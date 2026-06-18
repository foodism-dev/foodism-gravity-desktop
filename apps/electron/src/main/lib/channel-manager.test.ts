import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, mock, test } from 'bun:test'

mock.module('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: (): boolean => true,
    encryptString: (value: string): Buffer => Buffer.from(value, 'utf-8'),
    decryptString: (value: Buffer): string => value.toString('utf-8'),
  },
}))

const {
  FOODISM_DEFAULT_CHANNEL_ID,
  FOODISM_DEFAULT_MODEL_ID,
  decryptApiKey,
  deleteChannel,
  listChannels,
  updateChannel,
} = await import('./channel-manager')
const { getSettings } = await import('./settings-service')

const tempDirs: string[] = []

function useTempConfigDir(): void {
  const dir = mkdtempSync(join(tmpdir(), 'foodism-channel-test-'))
  tempDirs.push(dir)
  process.env.FOODISM_GRAVITY_CONFIG_DIR = dir
}

afterEach(() => {
  delete process.env.FOODISM_GRAVITY_CONFIG_DIR
  delete process.env.FOODISM_DEFAULT_RELAY_API_KEY
  delete process.env.FOODISM_DEFAULT_OPENROUTER_API_KEY
  delete process.env.OPENROUTER_API_KEY
  delete process.env.FOODISM_DEFAULT_DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.FOODISM_DEFAULT_PROVIDER_API_KEY
  delete process.env.FOODISM_DEFAULT_MODEL_ID
  delete process.env.FOODISM_DEFAULT_MODEL_NAME

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Foodism 默认中转站渠道', () => {
  test('Given .env 提供中转站 Key When 加载渠道 Then 创建锁定的默认渠道', () => {
    useTempConfigDir()
    process.env.FOODISM_DEFAULT_RELAY_API_KEY = 'sk-relay-test'

    const channels = listChannels()
    const channel = channels.find((item) => item.id === FOODISM_DEFAULT_CHANNEL_ID)

    expect(channel).toMatchObject({
      id: FOODISM_DEFAULT_CHANNEL_ID,
      name: '万店引力默认模型',
      provider: 'anthropic-compatible',
      baseUrl: 'https://code.newcli.com/claude/ultra',
      enabled: true,
      locked: true,
      managedBy: 'foodism-default',
    })
    expect(channel?.models).toEqual([
      { id: FOODISM_DEFAULT_MODEL_ID, name: 'Claude Opus 4.6', enabled: true },
    ])
    expect(decryptApiKey(FOODISM_DEFAULT_CHANNEL_ID)).toBe('sk-relay-test')
  })

  test('Given 默认渠道已创建 When 修改或删除 Then 拒绝操作', () => {
    useTempConfigDir()
    process.env.FOODISM_DEFAULT_RELAY_API_KEY = 'sk-relay-test'
    listChannels()

    expect(() => updateChannel(FOODISM_DEFAULT_CHANNEL_ID, { enabled: false })).toThrow('内置默认渠道不可修改')
    expect(() => deleteChannel(FOODISM_DEFAULT_CHANNEL_ID)).toThrow('内置默认渠道不可删除')
  })

  test('Given .env 提供中转站 Key When 首次读取设置 Then 默认选中 Claude Opus 4.6', () => {
    useTempConfigDir()
    process.env.FOODISM_DEFAULT_RELAY_API_KEY = 'sk-relay-test'

    const settings = getSettings()

    expect(settings.agentChannelId).toBe(FOODISM_DEFAULT_CHANNEL_ID)
    expect(settings.agentModelId).toBe(FOODISM_DEFAULT_MODEL_ID)
    expect(settings.agentChannelIds).toContain(FOODISM_DEFAULT_CHANNEL_ID)
  })

  test('Given 老版本 DeepSeek 默认渠道已存在 When 加载渠道 Then 迁移为中转站默认渠道', () => {
    useTempConfigDir()
    process.env.FOODISM_DEFAULT_RELAY_API_KEY = 'sk-relay-test'
    const configPath = join(process.env.FOODISM_GRAVITY_CONFIG_DIR!, 'channels.json')
    writeFileSync(configPath, JSON.stringify({
      version: 1,
      channels: [
        {
          id: 'foodism-default-deepseek',
          name: '万店引力默认模型',
          provider: 'deepseek',
          baseUrl: 'https://api.deepseek.com/anthropic',
          apiKey: 'old-key',
          models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', enabled: true }],
          enabled: true,
          locked: true,
          managedBy: 'foodism-default',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }), 'utf-8')

    const channels = listChannels()
    const channel = channels.find((item) => item.id === FOODISM_DEFAULT_CHANNEL_ID)

    expect(channels.some((item) => item.id === 'foodism-default-deepseek')).toBe(false)
    expect(channel).toMatchObject({
      id: FOODISM_DEFAULT_CHANNEL_ID,
      provider: 'anthropic-compatible',
      baseUrl: 'https://code.newcli.com/claude/ultra',
      locked: true,
      managedBy: 'foodism-default',
    })
    expect(channel?.models).toEqual([
      { id: FOODISM_DEFAULT_MODEL_ID, name: 'Claude Opus 4.6', enabled: true },
    ])
  })
})
