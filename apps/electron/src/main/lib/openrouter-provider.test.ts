import { describe, expect, test } from 'bun:test'
import { detectThinkingCapability } from '@proma/core'

describe('OpenRouter Claude 思考能力检测', () => {
  test('Given OpenRouter Opus 4.6 slug When 检测能力 Then 使用 adaptive 优先模式', () => {
    expect(detectThinkingCapability('openrouter', 'anthropic/claude-opus-4.6')).toEqual({
      mode: 'adaptive-preferred',
      disableStrategy: 'explicit-disabled',
    })
  })
})
