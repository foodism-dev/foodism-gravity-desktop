import { describe, expect, test } from 'bun:test'
import { REBUILD_IPC_CHANNELS } from '../../types/rebuild'
import {
  buildRebuildEntityListUrl,
  buildRebuildEntityGetUrl,
  buildRebuildSignedQuery,
  getSupplyGoodsApprovalStateOptions,
  normalizeRebuildBaseUrl,
} from './rebuild-service'

describe('REBUILD OpenAPI 签名', () => {
  test('Given 官方文档示例参数 When 使用 MD5 签名 Then 得到文档中的 sign', () => {
    const signed = buildRebuildSignedQuery({
      appId: '999999999',
      appSecret: 'hRwXFvykcmD6MofNOHOzaMSuaB6U76P077ZT8ZFj',
      signType: 'MD5',
      timestamp: 1602772338,
      params: {
        page_no: 2,
      },
    })

    expect(signed.sign).toBe('2356574a32b680514bd3b38e4b0cd960')
  })

  test('Given REBUILD 根地址 When 规范化 Then 指向 gw/api 目录', () => {
    expect(normalizeRebuildBaseUrl('https://sale.foodism.cc')).toBe('https://sale.foodism.cc/gw/api/')
    expect(normalizeRebuildBaseUrl('https://sale.foodism.cc/gw/api')).toBe('https://sale.foodism.cc/gw/api/')
  })
})

describe('SupplyGoods 列表请求', () => {
  test('Given SupplyGoods 查询参数 When 构建 URL Then 默认请求 entity/list 并带上签名参数', () => {
    const url = buildRebuildEntityListUrl({
      baseUrl: 'https://sale.foodism.cc',
      appId: 'test-app',
      appSecret: 'test-secret',
      timestamp: 1700000000,
      request: {
        fields: ['SupplyGoodsId', 'goodsName'],
        pageNo: 2,
        pageSize: 50,
        sort: 'modifiedOn:desc',
        filter: {
          entity: 'SupplyGoods',
          equation: 'AND',
          items: [{ field: 'goodsName', op: 'LK', value: '鸡' }],
        },
      },
    })

    expect(url.origin).toBe('https://sale.foodism.cc')
    expect(url.pathname).toBe('/gw/api/entity/list')
    expect(url.searchParams.get('entity')).toBe('SupplyGoods')
    expect(url.searchParams.get('fields')).toBe('SupplyGoodsId,goodsName')
    expect(url.searchParams.get('page_no')).toBe('2')
    expect(url.searchParams.get('page_size')).toBe('50')
    expect(url.searchParams.get('sort')).toBe('modifiedOn:desc')
    expect(url.searchParams.get('sign_type')).toBe('MD5')
    expect(url.searchParams.get('sign')).toBeTruthy()
    expect(JSON.parse(url.searchParams.get('filter') || '{}')).toEqual({
      entity: 'SupplyGoods',
      equation: 'AND',
      items: [{ field: 'goodsName', op: 'LK', value: '鸡' }],
    })
  })

  test('Given 未指定字段 When 构建 URL Then 使用 SupplyGoods 默认字段', () => {
    const url = buildRebuildEntityListUrl({
      baseUrl: 'https://sale.foodism.cc',
      appId: 'test-app',
      appSecret: 'test-secret',
      timestamp: 1700000000,
      request: {
        pageNo: 1,
        pageSize: 20,
      },
    })

    expect(url.searchParams.get('fields')).toBe(
      [
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
      ].join(',')
    )
  })
})

describe('SupplyGoods 单条记录请求', () => {
  test('Given SupplyGoods ID When 构建 URL Then 请求 entity/get 并带上字段', () => {
    const url = buildRebuildEntityGetUrl({
      baseUrl: 'https://sale.foodism.cc',
      appId: 'test-app',
      appSecret: 'test-secret',
      timestamp: 1700000000,
      request: {
        id: '944-019eee7db58948ec',
        fields: ['SupplyGoodsId', 'goodsName', 'approvalState'],
      },
    })

    expect(url.pathname).toBe('/gw/api/entity/get')
    expect(url.searchParams.get('entity')).toBe('SupplyGoods')
    expect(url.searchParams.get('id')).toBe('944-019eee7db58948ec')
    expect(url.searchParams.get('fields')).toBe('SupplyGoodsId,goodsName,approvalState')
    expect(url.searchParams.get('sign')).toBeTruthy()
  })
})

describe('REBUILD IPC 通道', () => {
  test('暴露 SupplyGoods 列表查询通道', () => {
    expect(REBUILD_IPC_CHANNELS.LIST_SUPPLY_GOODS).toBe('rebuild:list-supply-goods')
  })

  test('暴露 SupplyGoods approvalState 选项通道', () => {
    expect(REBUILD_IPC_CHANNELS.GET_SUPPLY_GOODS_APPROVAL_STATE_OPTIONS).toBe('rebuild:get-supply-goods-approval-state-options')
  })

  test('暴露 SupplyGoods 单条记录查询通道', () => {
    expect(REBUILD_IPC_CHANNELS.GET_SUPPLY_GOODS).toBe('rebuild:get-supply-goods')
  })
})

describe('SupplyGoods approvalState 元数据', () => {
  test('Given 网页 field-options 返回内容 When 读取默认选项 Then 得到完整审批状态列', () => {
    expect(getSupplyGoodsApprovalStateOptions()).toEqual([
      { default: true, id: 1, text: '草稿' },
      { default: false, id: 2, text: '审批中' },
      { default: false, id: 10, text: '通过' },
      { default: false, id: 11, text: '驳回' },
      { default: false, id: 12, text: '撤回' },
      { default: false, id: 13, text: '撤销' },
    ])
  })
})
