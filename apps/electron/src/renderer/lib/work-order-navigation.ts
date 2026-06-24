import type { ActiveView } from '../atoms/active-view'

const DEFAULT_WORK_ORDER_WEB_URL = 'http://localhost:5174/tickets'

export interface WorkOrderNavItem {
  view: Extract<ActiveView, 'work-orders'>
  label: string
  ariaLabel: string
}

/** 我的工单左侧导航入口，供侧边栏与测试复用。 */
export const WORK_ORDER_NAV_ITEM: WorkOrderNavItem = {
  view: 'work-orders',
  label: '我的工单',
  ariaLabel: '我的工单',
}

/** 构建 PC 端“我的工单”跳转到 Web 工单台的地址。 */
export function buildWorkOrderWebUrl(value?: string): string {
  const rawUrl = value?.trim() || DEFAULT_WORK_ORDER_WEB_URL

  try {
    const url = new URL(rawUrl)
    if (url.pathname === '/' || url.pathname === '') {
      url.pathname = '/tickets'
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return DEFAULT_WORK_ORDER_WEB_URL
  }
}
