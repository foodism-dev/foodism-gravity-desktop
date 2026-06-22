/**
 * REBUILD OpenAPI 服务
 *
 * 负责封装 REBUILD 签名与业务记录查询，调用凭证仅从主进程环境变量读取。
 */

import { createHash } from 'node:crypto'
import type {
  RebuildEntityGetRequest,
  RebuildEntityListRequest,
  RebuildFieldOption,
  RebuildSignType,
  RebuildSupplyGoodsRecord,
  RebuildSupplyGoodsListResult,
} from '../../types'

export interface RebuildSignedQueryInput {
  appId: string
  appSecret: string
  signType?: RebuildSignType
  timestamp?: number
  params?: Record<string, string | number | boolean | null | undefined>
}

export interface RebuildSignedQuery {
  appid: string
  timestamp: string
  sign_type: RebuildSignType
  sign: string
  params: Record<string, string>
}

export interface RebuildEntityListUrlInput {
  baseUrl: string
  appId: string
  appSecret: string
  timestamp?: number
  signType?: RebuildSignType
  request?: RebuildEntityListRequest
}

export interface RebuildEntityGetUrlInput {
  baseUrl: string
  appId: string
  appSecret: string
  timestamp?: number
  signType?: RebuildSignType
  request: RebuildEntityGetRequest
}

export interface RebuildOpenApiResponse<T> {
  error_code: number
  error_msg: string
  data?: T
  error_data?: unknown
}

const SUPPLY_GOODS_ENTITY = 'SupplyGoods'
const DEFAULT_SUPPLY_GOODS_FIELDS = [
  'SupplyGoodsId',
  'autoId',
  'goodsName',
  'goodsNameInput',
  'hostNameInput',
  'auditStatus',
  'approvalState',
  'modifiedOn',
  'createdOn',
  'validUntil',
  'saleBegin',
  'bdCity',
  'bdGroup',
]
const DEFAULT_SIGN_TYPE: RebuildSignType = 'MD5'

const SUPPLY_GOODS_APPROVAL_STATE_OPTIONS: RebuildFieldOption[] = [
  { default: true, id: 1, text: '草稿' },
  { default: false, id: 2, text: '审批中' },
  { default: false, id: 10, text: '通过' },
  { default: false, id: 11, text: '驳回' },
  { default: false, id: 12, text: '撤回' },
  { default: false, id: 13, text: '撤销' },
]

/**
 * 规范化 REBUILD OpenAPI 根地址。
 */
export function normalizeRebuildBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('REBUILD_BASE_URL 不能为空')
  }
  if (trimmed.endsWith('/gw/api')) {
    return `${trimmed}/`
  }
  return `${trimmed}/gw/api/`
}

function stringifyParam(value: string | number | boolean | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return String(value)
}

function hashSign(raw: string, signType: RebuildSignType): string {
  const algorithm = signType === 'SHA1' ? 'sha1' : 'md5'
  return createHash(algorithm).update(raw).digest('hex')
}

/**
 * 按 REBUILD OpenAPI 文档构建签名参数。
 */
export function buildRebuildSignedQuery(input: RebuildSignedQueryInput): RebuildSignedQuery {
  const signType = input.signType ?? DEFAULT_SIGN_TYPE
  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000))
  const params: Record<string, string> = {}

  for (const [key, value] of Object.entries(input.params ?? {})) {
    const normalized = stringifyParam(value)
    if (normalized !== null) params[key] = normalized
  }

  params.appid = input.appId
  params.timestamp = timestamp
  params.sign_type = signType

  const sortedKeys = Object.keys(params).sort()
  const signBody = sortedKeys
    .map((key) => `${key}=${params[key]}`)
    .join('&')

  const sign = hashSign(`${signBody}&${input.appId}.${input.appSecret}`, signType)

  return {
    appid: input.appId,
    timestamp,
    sign_type: signType,
    sign,
    params,
  }
}

function buildSupplyGoodsParams(request: RebuildEntityListRequest = {}): Record<string, string | number> {
  const params: Record<string, string | number> = {
    entity: SUPPLY_GOODS_ENTITY,
    fields: (request.fields?.length ? request.fields : DEFAULT_SUPPLY_GOODS_FIELDS).join(','),
  }

  if (request.pageNo !== undefined) params.page_no = request.pageNo
  if (request.pageSize !== undefined) params.page_size = request.pageSize
  if (request.sort) params.sort = request.sort
  if (request.filter) params.filter = JSON.stringify(request.filter)

  return params
}

function buildSupplyGoodsGetParams(request: RebuildEntityGetRequest): Record<string, string | number> {
  return {
    entity: SUPPLY_GOODS_ENTITY,
    id: request.id,
    fields: (request.fields?.length ? request.fields : DEFAULT_SUPPLY_GOODS_FIELDS).join(','),
  }
}

/**
 * 构建 SupplyGoods 多记录查询 URL。
 */
export function buildRebuildEntityListUrl(input: RebuildEntityListUrlInput): URL {
  const params = buildSupplyGoodsParams(input.request)
  const signed = buildRebuildSignedQuery({
    appId: input.appId,
    appSecret: input.appSecret,
    signType: input.signType,
    timestamp: input.timestamp,
    params,
  })

  const url = new URL('entity/list', normalizeRebuildBaseUrl(input.baseUrl))
  for (const [key, value] of Object.entries(signed.params).sort(([left], [right]) => left.localeCompare(right))) {
    url.searchParams.set(key, value)
  }
  url.searchParams.set('sign', signed.sign)
  return url
}

/**
 * 构建 SupplyGoods 单条记录查询 URL。
 */
export function buildRebuildEntityGetUrl(input: RebuildEntityGetUrlInput): URL {
  const params = buildSupplyGoodsGetParams(input.request)
  const signed = buildRebuildSignedQuery({
    appId: input.appId,
    appSecret: input.appSecret,
    signType: input.signType,
    timestamp: input.timestamp,
    params,
  })

  const url = new URL('entity/get', normalizeRebuildBaseUrl(input.baseUrl))
  for (const [key, value] of Object.entries(signed.params).sort(([left], [right]) => left.localeCompare(right))) {
    url.searchParams.set(key, value)
  }
  url.searchParams.set('sign', signed.sign)
  return url
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`缺少 REBUILD OpenAPI 配置: ${name}`)
  }
  return value
}

async function readJsonResponse<T>(response: Response): Promise<RebuildOpenApiResponse<T>> {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`REBUILD OpenAPI 请求失败 (${response.status}): ${text || response.statusText}`)
  }

  try {
    return JSON.parse(text) as RebuildOpenApiResponse<T>
  } catch (error) {
    console.error('[REBUILD] 响应不是合法 JSON:', error)
    throw new Error('REBUILD OpenAPI 返回格式错误')
  }
}

/**
 * 查询 SupplyGoods 多条记录。
 */
export async function listSupplyGoods(
  request: RebuildEntityListRequest = {}
): Promise<RebuildSupplyGoodsListResult> {
  const url = buildRebuildEntityListUrl({
    baseUrl: readRequiredEnv('REBUILD_BASE_URL'),
    appId: readRequiredEnv('REBUILD_APP_ID'),
    appSecret: readRequiredEnv('REBUILD_APP_SECRET'),
    request,
  })

  console.log(`[REBUILD] 查询 SupplyGoods: ${url.origin}${url.pathname}`)

  const result = await readJsonResponse<RebuildSupplyGoodsListResult>(await fetch(url))
  if (result.error_code !== 0) {
    throw new Error(result.error_msg || `REBUILD OpenAPI 调用失败: ${result.error_code}`)
  }
  return result.data ?? {}
}

/**
 * 查询 SupplyGoods 单条记录。
 */
export async function getSupplyGoods(
  request: RebuildEntityGetRequest
): Promise<RebuildSupplyGoodsRecord> {
  const url = buildRebuildEntityGetUrl({
    baseUrl: readRequiredEnv('REBUILD_BASE_URL'),
    appId: readRequiredEnv('REBUILD_APP_ID'),
    appSecret: readRequiredEnv('REBUILD_APP_SECRET'),
    request,
  })

  console.log(`[REBUILD] 查询 SupplyGoods 单条记录: ${url.origin}${url.pathname}`)

  const result = await readJsonResponse<RebuildSupplyGoodsRecord>(await fetch(url))
  if (result.error_code !== 0) {
    throw new Error(result.error_msg || `REBUILD OpenAPI 调用失败: ${result.error_code}`)
  }
  return result.data ?? {}
}

/**
 * 获取 SupplyGoods approvalState 选项。
 *
 * 当前 REBUILD OpenAPI 未暴露 `/commons/metadata/field-options` 对应的签名接口，
 * 因此先使用网页 metadata 返回的稳定选项作为本地元数据源。
 */
export function getSupplyGoodsApprovalStateOptions(): RebuildFieldOption[] {
  return SUPPLY_GOODS_APPROVAL_STATE_OPTIONS.map((option) => ({ ...option }))
}
