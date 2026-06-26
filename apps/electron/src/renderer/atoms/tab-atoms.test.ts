import { describe, expect, test } from 'bun:test'
import { closeTab, openTab, WORK_ORDERS_TAB_ID } from './tab-atoms'

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

  test('Given 已打开一个 Agent 会话 When 打开另一个历史会话 Then 保留旧标签并激活新标签', () => {
    const result = openTab(
      [{ id: 'agent-1', type: 'agent', sessionId: 'agent-1', title: '用户问候' }],
      { type: 'agent', sessionId: 'agent-2', title: '新会话' },
    )

    expect(result.activeTabId).toBe('agent-2')
    expect(result.tabs).toEqual([
      { id: 'agent-1', type: 'agent', sessionId: 'agent-1', title: '用户问候' },
      { id: 'agent-2', type: 'agent', sessionId: 'agent-2', title: '新会话' },
    ])
  })

  test('Given 历史会话已经打开 When 再次打开该会话 Then 进入已有标签且不重复新增', () => {
    const result = openTab(
      [
        { id: 'agent-1', type: 'agent', sessionId: 'agent-1', title: '用户问候' },
        { id: 'agent-2', type: 'agent', sessionId: 'agent-2', title: '新会话' },
      ],
      { type: 'agent', sessionId: 'agent-1', title: '用户问候' },
    )

    expect(result.activeTabId).toBe('agent-1')
    expect(result.tabs).toEqual([
      { id: 'agent-1', type: 'agent', sessionId: 'agent-1', title: '用户问候' },
      { id: 'agent-2', type: 'agent', sessionId: 'agent-2', title: '新会话' },
    ])
  })

  test('Given 已有会话标签 When 打开我的工单 Then 追加并激活工单标签', () => {
    const result = openTab(
      [{ id: 'agent-1', type: 'agent', sessionId: 'agent-1', title: '用户问候' }],
      { type: 'work-orders', sessionId: WORK_ORDERS_TAB_ID, title: '我的工单' },
    )

    expect(result.activeTabId).toBe(WORK_ORDERS_TAB_ID)
    expect(result.tabs).toEqual([
      { id: 'agent-1', type: 'agent', sessionId: 'agent-1', title: '用户问候' },
      { id: WORK_ORDERS_TAB_ID, type: 'work-orders', sessionId: WORK_ORDERS_TAB_ID, title: '我的工单' },
    ])
  })

  test('Given RB 审核标签已打开 When 再次打开同一地址 Then 聚焦已有标签', () => {
    const result = openTab(
      [
        { id: WORK_ORDERS_TAB_ID, type: 'work-orders', sessionId: WORK_ORDERS_TAB_ID, title: '我的工单' },
        {
          id: 'web:https://sale.foodism.cc/app/SupplyGoods/list#!/View/SupplyGoods/F00-838',
          type: 'web',
          sessionId: 'https://sale.foodism.cc/app/SupplyGoods/list#!/View/SupplyGoods/F00-838',
          title: 'RB审核 · F00-838',
        },
      ],
      {
        type: 'web',
        sessionId: 'https://sale.foodism.cc/app/SupplyGoods/list#!/View/SupplyGoods/F00-838',
        title: 'RB审核 · F00-838',
      },
    )

    expect(result.activeTabId).toBe('web:https://sale.foodism.cc/app/SupplyGoods/list#!/View/SupplyGoods/F00-838')
    expect(result.tabs).toHaveLength(2)
  })

  test('Given 只有一个会话标签 When 关闭该标签 Then 标签栏清空', () => {
    const tabs = [
      { id: 'chat-1', type: 'chat' as const, sessionId: 'chat-1', title: '新对话' },
    ]

    const result = closeTab(tabs, 'chat-1', 'chat-1')

    expect(result).toEqual({ tabs: [], activeTabId: null })
  })
})
