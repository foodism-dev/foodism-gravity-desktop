import type { ActiveView } from '../atoms/active-view'

const DEFAULT_WORK_ORDER_WEB_URL = 'http://localhost:5174/tickets'
const REBUILD_SUPPLY_GOODS_APPROVAL_BASE_URL = 'https://sale.foodism.cc/app/SupplyGoods/list#!/View/SupplyGoods'

export interface WorkOrderWebUrlOptions {
  apiToken?: string | null
}

export interface WorkOrderNavItem {
  view: Extract<ActiveView, 'work-orders'>
  label: string
  ariaLabel: string
}

export interface RebuildApprovalTab {
  type: 'web'
  sessionId: string
  title: string
}

/** 我的工单左侧导航入口，供侧边栏与测试复用。 */
export const WORK_ORDER_NAV_ITEM: WorkOrderNavItem = {
  view: 'work-orders',
  label: '我的工单',
  ariaLabel: '我的工单',
}

/** 构建 PC 端“我的工单”跳转到 Web 工单台的地址。 */
export function buildWorkOrderWebUrl(value?: string, options: WorkOrderWebUrlOptions = {}): string {
  const rawUrl = value?.trim() || DEFAULT_WORK_ORDER_WEB_URL

  try {
    const url = new URL(rawUrl)
    if (url.pathname === '/' || url.pathname === '') {
      url.pathname = '/tickets'
    }
    url.searchParams.set('embedded', 'electron')
    if (options.apiToken) {
      url.searchParams.set('apiToken', options.apiToken)
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return DEFAULT_WORK_ORDER_WEB_URL
  }
}

export function buildRebuildApprovalUrl(supplyGoodsId: string): string {
  return `${REBUILD_SUPPLY_GOODS_APPROVAL_BASE_URL}/${encodeURIComponent(supplyGoodsId)}`
}

function buildRebuildApprovalTitle(supplyGoodsId: string, productName?: string): string {
  const titleTarget = productName?.trim() || supplyGoodsId
  return `rb 审核-${titleTarget}`
}

export function buildRebuildApprovalTab(supplyGoodsId: string, productName?: string): RebuildApprovalTab {
  return {
    type: 'web',
    sessionId: buildRebuildApprovalUrl(supplyGoodsId),
    title: buildRebuildApprovalTitle(supplyGoodsId, productName),
  }
}
