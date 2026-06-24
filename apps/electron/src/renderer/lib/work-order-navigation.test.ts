import { describe, expect, test } from 'bun:test'
import { buildWorkOrderWebUrl, WORK_ORDER_NAV_ITEM } from './work-order-navigation'

describe('我的工单导航', () => {
  test('暴露我的工单左侧导航入口', () => {
    expect(WORK_ORDER_NAV_ITEM).toEqual({
      view: 'work-orders',
      label: '我的工单',
      ariaLabel: '我的工单',
    })
  })

  test('未配置 Web 地址时默认跳转本地 frontend 工单列表', () => {
    expect(buildWorkOrderWebUrl()).toBe('http://localhost:5174/tickets')
  })

  test('配置 frontend origin 时自动补齐 tickets 路径', () => {
    expect(buildWorkOrderWebUrl('https://portal.foodism.cc')).toBe('https://portal.foodism.cc/tickets')
  })

  test('配置完整工单地址时保留路径与查询参数', () => {
    expect(buildWorkOrderWebUrl('https://portal.foodism.cc/workbench/tickets?source=pc')).toBe(
      'https://portal.foodism.cc/workbench/tickets?source=pc'
    )
  })
})
