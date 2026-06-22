import { describe, expect, test } from 'bun:test'
import { WORK_ORDER_NAV_ITEM } from './work-order-navigation'

describe('我的工单导航', () => {
  test('暴露我的工单左侧导航入口', () => {
    expect(WORK_ORDER_NAV_ITEM).toEqual({
      view: 'work-orders',
      label: '我的工单',
      ariaLabel: '我的工单',
    })
  })
})
