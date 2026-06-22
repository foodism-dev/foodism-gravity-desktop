/**
 * REBUILD OpenAPI 类型与 IPC 通道
 */

export type RebuildSignType = 'MD5' | 'SHA1'

export interface RebuildFilterItem {
  field: string
  op: string
  value?: string
  value2?: string
  index?: number
}

export interface RebuildAdvFilter {
  entity: string
  equation?: string
  items: RebuildFilterItem[]
}

export interface RebuildEntityListRequest {
  fields?: string[]
  pageNo?: number
  pageSize?: number
  sort?: string
  filter?: RebuildAdvFilter
}

export interface RebuildEntityGetRequest {
  id: string
  fields?: string[]
}

export interface RebuildSupplyGoodsRecord {
  id?: string
  [field: string]: unknown
}

export interface RebuildSupplyGoodsListResult {
  total?: number
  list?: RebuildSupplyGoodsRecord[]
  data?: RebuildSupplyGoodsRecord[]
  [field: string]: unknown
}

export interface RebuildFieldOption {
  default: boolean
  id: string | number
  text: string
}

export const REBUILD_IPC_CHANNELS = {
  LIST_SUPPLY_GOODS: 'rebuild:list-supply-goods',
  GET_SUPPLY_GOODS: 'rebuild:get-supply-goods',
  GET_SUPPLY_GOODS_APPROVAL_STATE_OPTIONS: 'rebuild:get-supply-goods-approval-state-options',
} as const
