import type { ActiveView } from '../atoms/active-view'

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
