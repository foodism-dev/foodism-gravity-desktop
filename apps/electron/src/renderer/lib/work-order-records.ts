import type { RebuildFieldOption, RebuildSupplyGoodsRecord } from '../../types'

const SUPPLY_GOODS_APPROVAL_BASE_URL = 'https://sale.foodism.cc/app/SupplyGoods/list#!/View/SupplyGoods'

export const SUPPLY_GOODS_WORK_ORDER_FIELDS = [
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
] as const

export const SUPPLY_GOODS_DETAIL_FIELDS = [
  ...SUPPLY_GOODS_WORK_ORDER_FIELDS,
  'bdUser',
  'bdUser.fullName',
  'saleAuditor',
  'productAuditors',
  'settleType',
  'showChannel',
  'supplyPrice',
  'goodsFeatures',
  'classification',
  'mealType',
  'reservationRule',
  'mainPic',
  'rbimages',
  'detailImages',
  'packageContract',
  'company',
  'company.companyName',
  'company.businessLicenseNo',
  'company.businessLicenseDate',
  'company.legalPerson',
  'company.foodLicense',
  'company.businessLicense',
  'rbhost',
  'rbhost.hostName',
  'rbhost.address',
  'rbhost.telephone',
  'rbhost.classification',
  'rbhost.businessLicensePicture',
  'rbhost.businessLicenseExpiryDate',
  'rbhost.certificationType',
] as const

export interface SupplyGoodsWorkOrderCard {
  id: string
  code: string
  title: string
  subtitle: string
  statusLabel: string
  stateLabel: string
  stateValue: number
  timeLabel: string
  cityLabel: string
  groupLabel: string
}

export interface SupplyGoodsWorkOrderColumn {
  id: string
  title: string
  stateValue: number
  default: boolean
  cards: SupplyGoodsWorkOrderCard[]
}

export interface SupplyGoodsDetailValue {
  label: string
  value: string
}

export interface SupplyGoodsDetailSection {
  title: string
  description: string
  items: SupplyGoodsDetailValue[]
}

export interface SupplyGoodsWorkOrderDetail {
  header: {
    id: string
    code: string
    title: string
    subtitle: string
    stateLabel: string
    stateValue: number
    timeLabel: string
  }
  baseSections: SupplyGoodsDetailSection[]
  completenessItems: SupplyGoodsDetailValue[]
  businessItems: SupplyGoodsDetailValue[]
  checkItems: SupplyGoodsDetailValue[]
  attributeItems: SupplyGoodsDetailValue[]
  progressItems: Array<SupplyGoodsDetailValue & { active: boolean }>
  activityItems: SupplyGoodsDetailValue[]
}

interface RebuildValueObject {
  value?: unknown
  text?: unknown
}

const SUPPLY_GOODS_APPROVAL_STATE_OPTIONS: RebuildFieldOption[] = [
  { default: true, id: 1, text: '草稿' },
  { default: false, id: 2, text: '审批中' },
  { default: false, id: 10, text: '通过' },
  { default: false, id: 11, text: '驳回' },
  { default: false, id: 12, text: '撤回' },
  { default: false, id: 13, text: '撤销' },
]

const PICKLIST_LABELS: Record<string, string> = {
  '012-018653e00d44083a': '统一收款',
  '012-018653e00d46083b': '分店收款',
  '012-018653e07107096a': '不限制',
  '012-018653e0710a096b': '仅直播间售卖',
  '012-0184a87067a44663': '普通E',
  '012-0184a87067a64664': '主套餐A',
  '012-0184a87067a84665': '常规B',
  '012-0184a87067aa4666': '代金券C',
  '012-0184a87067ab4667': '大单品D',
  '012-0184ebf4b23b4f1d': '暖冬专享',
  '012-017cca9ff6310032': '免预约',
  '012-017cca9e6bf10030': '在线预约',
  '012-017cca9e6bf40031': '电话预约',
  '012-017bc50c1ee30ab6': '待提报',
  '012-017b6e94c94a1037': '已提报',
  '012-017bc42db3b35f08': '销售运营已审核',
  '012-017b6e8d8ed66166': '已入库',
  '012-017b6e8d8ed76167': '已通过',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isValueObject(value: unknown): value is RebuildValueObject {
  return isRecord(value) && ('value' in value || 'text' in value)
}

function getRawFieldValue(record: RebuildSupplyGoodsRecord, field: string): unknown {
  const value = record[field]
  if (isValueObject(value)) return value.text ?? value.value
  return value
}

function getFieldText(record: RebuildSupplyGoodsRecord, field: string): string {
  const value = getRawFieldValue(record, field)
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.length > 0 ? `已上传（${value.length}）` : ''
  return String(value).trim()
}

function getFieldDisplayText(record: RebuildSupplyGoodsRecord, ...fields: string[]): string {
  for (const field of fields) {
    const value = getFieldText(record, field)
    if (value) return PICKLIST_LABELS[value] ?? value
  }
  return ''
}

function getFieldNumber(record: RebuildSupplyGoodsRecord, field: string): number {
  const value = getRawFieldValue(record, field)
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function splitBracketedGoodsName(goodsName: string): { title: string; subtitle: string } {
  const match = goodsName.match(/^\[([^\]]+)\](.+)$/)
  if (!match) {
    return {
      title: goodsName || '未命名商品',
      subtitle: '',
    }
  }

  return {
    title: match[1]?.trim() || '未命名商品',
    subtitle: match[2]?.trim() || '',
  }
}

function getTitleAndSubtitle(record: RebuildSupplyGoodsRecord): { title: string; subtitle: string } {
  const hostName = getFieldText(record, 'hostNameInput')
  const goodsNameInput = getFieldText(record, 'goodsNameInput')
  const goodsName = getFieldText(record, 'goodsName')

  if (hostName) {
    return {
      title: hostName,
      subtitle: goodsNameInput || splitBracketedGoodsName(goodsName).subtitle,
    }
  }

  const parsed = splitBracketedGoodsName(goodsName)
  return {
    title: parsed.title,
    subtitle: goodsNameInput || parsed.subtitle || getFieldText(record, 'bdGroup'),
  }
}

function formatDateTimeLabel(value: string, prefix: string): string {
  if (!value) return prefix
  const normalized = value.replace('T', ' ')
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/)
  if (!match) return `${prefix} ${value}`
  const [, , month, day, hour, minute] = match
  if (hour && minute) return `${prefix} ${month}-${day} ${hour}:${minute}`
  return `${prefix} ${month}-${day}`
}

export function getSupplyGoodsApprovalStateValue(record: RebuildSupplyGoodsRecord): number {
  return getFieldNumber(record, 'approvalState')
}

export function getSupplyGoodsDefaultApprovalStateOptions(): RebuildFieldOption[] {
  return SUPPLY_GOODS_APPROVAL_STATE_OPTIONS.map((option) => ({ ...option }))
}

function normalizeApprovalOptions(options: RebuildFieldOption[]): RebuildFieldOption[] {
  return options.length > 0 ? options : getSupplyGoodsDefaultApprovalStateOptions()
}

function getApprovalStateLabel(stateValue: number, options: RebuildFieldOption[]): string {
  return options.find((option) => Number(option.id) === stateValue)?.text ?? '未知状态'
}

export function formatSupplyGoodsWorkOrderCode(record: RebuildSupplyGoodsRecord): string {
  const autoId = getFieldText(record, 'autoId').replace(/\D/g, '')
  if (autoId) return `F${autoId}`

  const id = getFieldText(record, 'SupplyGoodsId') || getFieldText(record, 'id')
  const tail = id.replace(/[^a-zA-Z0-9]/g, '').slice(-5).toUpperCase()
  return tail ? `F${tail}` : 'F--'
}

export function buildSupplyGoodsApprovalUrl(recordId: string): string {
  return `${SUPPLY_GOODS_APPROVAL_BASE_URL}/${encodeURIComponent(recordId)}`
}

function toWorkOrderCard(record: RebuildSupplyGoodsRecord, approvalOptions: RebuildFieldOption[]): SupplyGoodsWorkOrderCard {
  const id = getFieldText(record, 'SupplyGoodsId') || getFieldText(record, 'id') || formatSupplyGoodsWorkOrderCode(record)
  const stateValue = getSupplyGoodsApprovalStateValue(record)
  const isCompleted = stateValue >= 10
  const { title, subtitle } = getTitleAndSubtitle(record)
  const stateLabel = getApprovalStateLabel(stateValue, approvalOptions)

  return {
    id,
    code: formatSupplyGoodsWorkOrderCode(record),
    title,
    subtitle,
    statusLabel: stateLabel,
    stateLabel,
    stateValue,
    timeLabel: formatDateTimeLabel(getFieldText(record, 'modifiedOn') || getFieldText(record, 'createdOn'), isCompleted ? '完成' : '更新'),
    cityLabel: getFieldText(record, 'bdCity'),
    groupLabel: getFieldText(record, 'bdGroup'),
  }
}

export function buildSupplyGoodsWorkOrderColumns(
  approvalOptions: RebuildFieldOption[],
  records: RebuildSupplyGoodsRecord[]
): SupplyGoodsWorkOrderColumn[] {
  const normalizedOptions = normalizeApprovalOptions(approvalOptions)
  const columns = normalizedOptions.map((option) => ({
    id: String(option.id),
    title: option.text,
    stateValue: Number(option.id),
    default: option.default,
    cards: [] as SupplyGoodsWorkOrderCard[],
  }))
  const columnByState = new Map(columns.map((column) => [column.stateValue, column]))

  for (const record of records) {
    const card = toWorkOrderCard(record, normalizedOptions)
    const column = columnByState.get(card.stateValue)
    if (column) column.cards.push(card)
  }

  return columns
}

function detailValue(label: string, value: string): SupplyGoodsDetailValue {
  return {
    label,
    value: value || '未提供',
  }
}

function uploadValue(record: RebuildSupplyGoodsRecord, field: string): string {
  const value = record[field]
  if (Array.isArray(value)) return value.length > 0 ? `已上传（${value.length}）` : '未上传'
  return value ? '已上传' : '未上传'
}

export function buildSupplyGoodsWorkOrderDetail(
  approvalOptions: RebuildFieldOption[],
  record: RebuildSupplyGoodsRecord
): SupplyGoodsWorkOrderDetail {
  const normalizedOptions = normalizeApprovalOptions(approvalOptions)
  const stateValue = getSupplyGoodsApprovalStateValue(record)
  const stateLabel = getApprovalStateLabel(stateValue, normalizedOptions)
  const { title, subtitle } = getTitleAndSubtitle(record)
  const code = formatSupplyGoodsWorkOrderCode(record)
  const id = getFieldText(record, 'SupplyGoodsId') || getFieldText(record, 'id')
  const modifiedOn = getFieldDisplayText(record, 'modifiedOn')
  const createdOn = getFieldDisplayText(record, 'createdOn')

  return {
    header: {
      id,
      code,
      title,
      subtitle,
      stateLabel,
      stateValue,
      timeLabel: formatDateTimeLabel(modifiedOn || createdOn, stateValue >= 10 ? '完成' : '更新'),
    },
    baseSections: [
      {
        title: '公司主体信息',
        description: '公司名称、证照与法人信息',
        items: [
          detailValue('公司主体', getFieldDisplayText(record, 'companyName', 'company')),
          detailValue('统一社会信用代码', getFieldDisplayText(record, 'businessLicenseNo')),
          detailValue('法人', getFieldDisplayText(record, 'legalPerson')),
        ],
      },
      {
        title: '商户门店信息',
        description: '门店名称、地址与联系方式',
        items: [
          detailValue('门店名称', getFieldDisplayText(record, 'hostName', 'rbhost', 'hostNameInput')),
          detailValue('门店地址', getFieldDisplayText(record, 'address')),
          detailValue('联系电话', getFieldDisplayText(record, 'telephone')),
        ],
      },
      {
        title: '商品基础信息',
        description: '名称、类目与售卖信息',
        items: [
          detailValue('提报商品', getFieldDisplayText(record, 'goodsNameInput')),
          detailValue('商品类目', getFieldDisplayText(record, 'classification')),
          detailValue('套餐类型', getFieldDisplayText(record, 'mealType')),
        ],
      },
      {
        title: '价格与结算信息',
        description: '结算方式、售价与渠道',
        items: [
          detailValue('结算价', getFieldDisplayText(record, 'supplyPrice')),
          detailValue('收款方式', getFieldDisplayText(record, 'settleType')),
          detailValue('投放渠道', getFieldDisplayText(record, 'showChannel')),
        ],
      },
      {
        title: '图约与内容信息',
        description: '合同、主图、轮播与详情图',
        items: [
          detailValue('套餐合同', uploadValue(record, 'packageContract')),
          detailValue('商品主图', uploadValue(record, 'mainPic')),
          detailValue('详情配图', uploadValue(record, 'detailImages')),
        ],
      },
      {
        title: '销售/区域判断信息',
        description: 'BD、城市、小组与销售支持',
        items: [
          detailValue('签约BD', getFieldDisplayText(record, 'bdUser', 'fullName')),
          detailValue('签约城市', getFieldDisplayText(record, 'bdCity')),
          detailValue('签约小组', getFieldDisplayText(record, 'bdGroup')),
        ],
      },
    ],
    completenessItems: [
      detailValue('营业执照', uploadValue(record, 'businessLicensePicture')),
      detailValue('食品经营许可证', uploadValue(record, 'foodLicense')),
      detailValue('套餐合同', uploadValue(record, 'packageContract')),
      detailValue('商品主图', uploadValue(record, 'mainPic')),
      detailValue('套餐图片', uploadValue(record, 'rbimages')),
      detailValue('详情图片', uploadValue(record, 'detailImages')),
    ],
    businessItems: [
      detailValue('经营类目', getFieldDisplayText(record, 'classification')),
      detailValue('证件到期', getFieldDisplayText(record, 'businessLicenseExpiryDate', 'businessLicenseDate')),
      detailValue('核销有效期', getFieldDisplayText(record, 'validUntil')),
      detailValue('售卖开始', getFieldDisplayText(record, 'saleBegin')),
      detailValue('预约规则', getFieldDisplayText(record, 'reservationRule')),
      detailValue('商品审核', getFieldDisplayText(record, 'auditStatus')),
    ],
    checkItems: [
      detailValue('营业执照完整性', uploadValue(record, 'businessLicensePicture')),
      detailValue('商品主图清晰度', uploadValue(record, 'mainPic')),
      detailValue('轮播图片完整性', uploadValue(record, 'rbimages')),
      detailValue('详情图片完整性', uploadValue(record, 'detailImages')),
      detailValue('套餐合同完整性', uploadValue(record, 'packageContract')),
    ],
    attributeItems: [
      detailValue('工单编号', code),
      detailValue('商户名称', title),
      detailValue('商品名称', subtitle),
      detailValue('提报销售', getFieldDisplayText(record, 'bdUser', 'fullName')),
      detailValue('当前节点', stateLabel),
      detailValue('处理截止', getFieldDisplayText(record, 'validUntil')),
    ],
    progressItems: normalizedOptions.map((option) => ({
      label: option.text,
      value: Number(option.id) === stateValue ? '当前' : '',
      active: Number(option.id) === stateValue,
    })),
    activityItems: [
      detailValue('创建记录', createdOn),
      detailValue('最近更新', modifiedOn),
    ],
  }
}
