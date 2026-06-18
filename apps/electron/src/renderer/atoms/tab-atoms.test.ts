import { describe, expect, test } from 'bun:test'
import { closeTab, openTab } from './tab-atoms'

describe('顶部标签页不常驻草稿页', () => {
  test('Given 无标签 When 打开 Chat 会话 Then 只显示当前会话', () => {
    const result = openTab([], {
      type: 'chat',
      sessionId: 'chat-1',
      title: '新对话',
    })

    expect(result.activeTabId).toBe('chat-1')
    expect(result.tabs).toEqual([
      { id: 'chat-1', type: 'chat', sessionId: 'chat-1', title: '新对话' },
    ])
  })

  test('Given 只有一个会话标签 When 关闭该标签 Then 标签栏清空', () => {
    const tabs = [
      { id: 'chat-1', type: 'chat' as const, sessionId: 'chat-1', title: '新对话' },
    ]

    const result = closeTab(tabs, 'chat-1', 'chat-1')

    expect(result).toEqual({ tabs: [], activeTabId: null })
  })
})
