import { describe, expect, test } from 'bun:test'
import type { RebuildSupplyGoodsRecord } from '../../types'
import {
  buildSupplyGoodsApprovalUrl,
  buildSupplyGoodsWorkOrderDetail,
  buildSupplyGoodsWorkOrderColumns,
  formatSupplyGoodsWorkOrderCode,
  getSupplyGoodsApprovalStateValue,
  getSupplyGoodsDefaultApprovalStateOptions,
} from './work-order-records'

describe('SupplyGoods 工单记录', () => {
  test('Given approvalState 选项和记录 When 构建列 Then 每个状态选项都生成一列', () => {
    const records: RebuildSupplyGoodsRecord[] = [
      {
        SupplyGoodsId: '944-pending',
        autoId: '151,825',
        hostNameInput: '南霈东南亚餐厅',
        goodsNameInput: '泰式小龙虾套餐',
        approvalState: { value: 2, text: 2 },
        auditStatus: { value: '012-017bc50c1ee30ab6', text: '012-017bc50c1ee30ab6' },
        modifiedOn: '2026-06-22 16:18:02',
      },
      {
        SupplyGoodsId: '944-done',
        autoId: '151,964',
        hostNameInput: '野营风·地摊烤肉',
        goodsNameInput: '夏日超值烤肉3-4人餐',
        approvalState: { value: 10, text: 10 },
        auditStatus: { value: '012-017b6e8d8ed76167', text: '012-017b6e8d8ed76167' },
        modifiedOn: '2026-06-22 16:17:57',
      },
    ]

    const columns = buildSupplyGoodsWorkOrderColumns(getSupplyGoodsDefaultApprovalStateOptions(), records)

    expect(columns.map((column) => column.title)).toEqual(['草稿', '审批中', '通过', '驳回', '撤回', '撤销'])
    expect(columns.find((column) => column.stateValue === 2)?.cards).toHaveLength(1)
    expect(columns.find((column) => column.stateValue === 10)?.cards).toHaveLength(1)
    expect(columns.find((column) => column.stateValue === 2)?.cards[0]).toMatchObject({
      id: '944-pending',
      code: 'F151825',
      title: '南霈东南亚餐厅',
      subtitle: '泰式小龙虾套餐',
      statusLabel: '审批中',
      stateLabel: '审批中',
      stateValue: 2,
    })
    expect(columns.find((column) => column.stateValue === 10)?.cards[0]).toMatchObject({
      id: '944-done',
      code: 'F151964',
      statusLabel: '通过',
      stateLabel: '通过',
      stateValue: 10,
    })
  })

  test('Given 不完整商品字段 When 构建工单 Then 使用可读兜底标题与编号', () => {
    const columns = buildSupplyGoodsWorkOrderColumns(getSupplyGoodsDefaultApprovalStateOptions(), [
      {
        SupplyGoodsId: '944-019eee65dfa13e8f',
        goodsName: '[吃肉狂欢]2-3人餐',
        approvalState: 13,
        modifiedOn: '2026-06-22 16:15:04',
      },
    ])

    expect(columns.find((column) => column.stateValue === 13)?.cards[0]).toMatchObject({
      code: 'F13E8F',
      title: '吃肉狂欢',
      subtitle: '2-3人餐',
      statusLabel: '撤销',
      stateLabel: '撤销',
    })
  })

  test('Given REBUILD 引用对象与原始值 When 读取状态 Then 都能得到数值', () => {
    expect(getSupplyGoodsApprovalStateValue({ approvalState: { value: 2, text: 2 } })).toBe(2)
    expect(getSupplyGoodsApprovalStateValue({ approvalState: '10' })).toBe(10)
    expect(getSupplyGoodsApprovalStateValue({ approvalState: undefined })).toBe(0)
  })

  test('Given metadata 选项 When 读取默认状态 Then 包含网页 field-options 返回的状态', () => {
    expect(getSupplyGoodsDefaultApprovalStateOptions()).toEqual([
      { default: true, id: 1, text: '草稿' },
      { default: false, id: 2, text: '审批中' },
      { default: false, id: 10, text: '通过' },
      { default: false, id: 11, text: '驳回' },
      { default: false, id: 12, text: '撤回' },
      { default: false, id: 13, text: '撤销' },
    ])
  })

  test('Given autoId 或业务 ID When 格式化编号 Then 得到短编号', () => {
    expect(formatSupplyGoodsWorkOrderCode({ autoId: '151,825' })).toBe('F151825')
    expect(formatSupplyGoodsWorkOrderCode({ SupplyGoodsId: '944-019eee65dfa13e8f' })).toBe('F13E8F')
  })

  test('Given SupplyGoods 记录 ID When 构建审批跳转链接 Then 指向 REBUILD 审批页', () => {
    expect(buildSupplyGoodsApprovalUrl('944-019eeeb5c4b15e17')).toBe(
      'https://sale.foodism.cc/app/SupplyGoods/list#!/View/SupplyGoods/944-019eeeb5c4b15e17'
    )
  })

  test('Given 单条 SupplyGoods 记录 When 构建详情 Then 匹配截图所需字段分区', () => {
    const detail = buildSupplyGoodsWorkOrderDetail(getSupplyGoodsDefaultApprovalStateOptions(), {
      SupplyGoodsId: '944-019eee7db58948ec',
      autoId: '152,043',
      hostNameInput: '禧聚晟宴',
      goodsNameInput: '禧聚晟宴3-4人餐',
      approvalState: { value: 11, text: 11 },
      companyName: '北京晟阿福餐饮管理有限公司',
      businessLicenseNo: '91110114MA01N9N047',
      legalPerson: '宋阳',
      hostName: '禧聚晟宴川湘菜(温都水城店)',
      address: '北京市昌平区北七家镇温都水城商业街东楼11号',
      telephone: '18610218788',
      supplyPrice: '80.96',
      settleType: { value: '012-018653e00d44083a' },
      saleBegin: '2026-06-22',
      validUntil: '2026-09-22',
      bdUser: { text: '黄建鑫' },
      bdCity: { text: '北京二区' },
      bdGroup: { text: '黄建鑫组' },
      packageContract: ['rb/20260622/contract.pdf'],
      mainPic: ['rb/20260622/main.png'],
      rbimages: ['rb/20260622/round.png'],
      detailImages: ['rb/20260622/detail.png'],
      businessLicensePicture: ['rb/20250418/license.png'],
      classification: { text: '同城优享.川菜.川菜' },
      modifiedOn: '2026-06-22 16:46:18',
      createdOn: '2026-06-22 16:41:16',
    })

    expect(detail.header).toMatchObject({
      id: '944-019eee7db58948ec',
      code: 'F152043',
      title: '禧聚晟宴',
      subtitle: '禧聚晟宴3-4人餐',
      stateLabel: '驳回',
    })
    expect(detail.attributeItems).toEqual(expect.arrayContaining([
      { label: '工单编号', value: 'F152043' },
      { label: '商户名称', value: '禧聚晟宴' },
      { label: '当前节点', value: '驳回' },
    ]))
    expect(detail.baseSections[0]?.items).toEqual(expect.arrayContaining([
      { label: '公司主体', value: '北京晟阿福餐饮管理有限公司' },
      { label: '统一社会信用代码', value: '91110114MA01N9N047' },
    ]))
    expect(detail.completenessItems).toEqual(expect.arrayContaining([
      { label: '营业执照', value: '已上传（1）' },
      { label: '商品主图', value: '已上传（1）' },
    ]))
    expect(detail.businessItems).toEqual(expect.arrayContaining([
      { label: '经营类目', value: '同城优享.川菜.川菜' },
      { label: '核销有效期', value: '2026-09-22' },
    ]))
  })
})
