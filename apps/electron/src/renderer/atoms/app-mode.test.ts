import { describe, expect, test } from 'bun:test'
import { normalizeAppMode } from './app-mode'

describe('单 Agent 模式', () => {
  test('Given 旧版持久化为 Chat When 读取应用模式 Then 归一为 Agent', () => {
    expect(normalizeAppMode('chat')).toBe('agent')
  })

  test('Given 旧版草稿模式 When 读取应用模式 Then 归一为 Agent', () => {
    expect(normalizeAppMode('scratch')).toBe('agent')
  })

  test('Given 已经是 Agent When 读取应用模式 Then 保持 Agent', () => {
    expect(normalizeAppMode('agent')).toBe('agent')
  })
})
