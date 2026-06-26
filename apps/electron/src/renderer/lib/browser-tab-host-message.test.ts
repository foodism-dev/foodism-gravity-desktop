import { describe, expect, test } from 'bun:test'

import { buildBrowserTabTitle, isOpenBrowserTabMessage, isReloadWorkOrdersMessage } from './browser-tab-host-message'

describe('业务浏览器 Host 消息', () => {
  test('Given RB approval url, When building browser tab title, Then it uses supply goods id', () => {
    expect(buildBrowserTabTitle('https://sale.foodism.cc/app/SupplyGoods/list#!/View/SupplyGoods/944-019efa94400a73d9'))
      .toBe('RB审核 · 944-019efa94400a73d9')
  })

  test('Given open browser tab payload, When checking host message, Then only valid urls pass', () => {
    expect(isOpenBrowserTabMessage({
      type: 'proma:open-browser-tab',
      url: 'https://sale.foodism.cc/app/SupplyGoods/list#!/View/SupplyGoods/944-019efa94400a73d9',
    })).toBe(true)
    expect(isOpenBrowserTabMessage({ type: 'proma:open-browser-tab', url: 'javascript:alert(1)' })).toBe(false)
  })

  test('Given reload work orders payload, When checking host message, Then only exact type passes', () => {
    expect(isReloadWorkOrdersMessage({ type: 'proma:reload-work-orders' })).toBe(true)
    expect(isReloadWorkOrdersMessage({ type: 'proma:reload-work-orders', url: 'https://example.com' })).toBe(true)
    expect(isReloadWorkOrdersMessage({ type: 'proma:open-browser-tab' })).toBe(false)
  })
})
