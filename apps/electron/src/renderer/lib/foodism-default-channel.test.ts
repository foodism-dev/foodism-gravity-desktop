import { describe, expect, test } from 'bun:test'
import type { Channel } from '@proma/shared'
import { getSelectableChannelModels } from './foodism-default-channel'

describe('Foodism 默认渠道模型展示', () => {
  test('Given 默认渠道含历史 DeepSeek 模型 When 构建可选模型 Then 只展示 Claude Opus 4.6', () => {
    const channel: Channel = {
      id: 'foodism-default-relay',
      name: '万店引力默认模型',
      provider: 'anthropic-compatible',
      baseUrl: 'https://code.newcli.com/claude/ultra',
      apiKey: 'encrypted',
      enabled: true,
      locked: true,
      managedBy: 'foodism-default',
      createdAt: 1,
      updatedAt: 1,
      models: [
        { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', enabled: true },
        { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', enabled: true },
      ],
    }

    expect(getSelectableChannelModels(channel)).toEqual([
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', enabled: true },
    ])
  })
})
