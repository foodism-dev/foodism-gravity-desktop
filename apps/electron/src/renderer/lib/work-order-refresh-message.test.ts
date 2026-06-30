import { describe, expect, test } from 'bun:test'

import { buildRefreshTicketMessage } from './work-order-refresh-message'

describe('工单刷新消息', () => {
  test('Given duplicate ticket ids, When building refresh message, Then it keeps trimmed unique ids', () => {
    expect(buildRefreshTicketMessage([' 944-a ', '944-a', '', '944-b'])).toEqual({
      type: 'proma:refresh-ticket',
      supplyGoodsIds: ['944-a', '944-b'],
    })
  })

  test('Given no valid ticket ids, When building refresh message, Then it returns null', () => {
    expect(buildRefreshTicketMessage(['', '   '])).toBeNull()
  })
})
