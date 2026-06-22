/**
 * 我的工单视图
 *
 * 从 REBUILD SupplyGoods 拉取商品审核记录，支持看板与单条详情切换。
 */

import * as React from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageSquare,
  RefreshCw,
  Share2,
  Sparkles,
  XCircle,
} from 'lucide-react'
import type { RebuildFieldOption, RebuildSupplyGoodsRecord } from '../../../types'
import { cn } from '@/lib/utils'
import {
  buildSupplyGoodsApprovalUrl,
  buildSupplyGoodsWorkOrderColumns,
  buildSupplyGoodsWorkOrderDetail,
  getSupplyGoodsDefaultApprovalStateOptions,
  SUPPLY_GOODS_DETAIL_FIELDS,
  SUPPLY_GOODS_WORK_ORDER_FIELDS,
  type SupplyGoodsDetailSection,
  type SupplyGoodsDetailValue,
  type SupplyGoodsWorkOrderCard,
  type SupplyGoodsWorkOrderColumn,
  type SupplyGoodsWorkOrderDetail,
} from '@/lib/work-order-records'

type WorkOrdersLoadState = 'idle' | 'loading' | 'success' | 'error'
type DetailLoadState = 'idle' | 'loading' | 'success' | 'error'

const WORK_ORDER_PAGE_SIZE = 40

function getResultRecords(result: Awaited<ReturnType<typeof window.electronAPI.listSupplyGoods>>): RebuildSupplyGoodsRecord[] {
  if (Array.isArray(result.list)) return result.list
  if (Array.isArray(result.data)) return result.data
  return []
}

export function WorkOrdersView(): React.ReactElement {
  const [approvalOptions, setApprovalOptions] = React.useState<RebuildFieldOption[]>(() => getSupplyGoodsDefaultApprovalStateOptions())
  const [columns, setColumns] = React.useState<SupplyGoodsWorkOrderColumn[]>(() => (
    buildSupplyGoodsWorkOrderColumns(getSupplyGoodsDefaultApprovalStateOptions(), [])
  ))
  const [loadState, setLoadState] = React.useState<WorkOrdersLoadState>('idle')
  const [errorMessage, setErrorMessage] = React.useState('')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<SupplyGoodsWorkOrderDetail | null>(null)
  const [detailState, setDetailState] = React.useState<DetailLoadState>('idle')
  const [detailError, setDetailError] = React.useState('')
  const loadRequestRef = React.useRef(0)
  const detailRequestRef = React.useRef(0)

  const loadWorkOrders = React.useCallback(async () => {
    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId
    setLoadState('loading')
    setErrorMessage('')

    try {
      const [nextApprovalOptions, result] = await Promise.all([
        window.electronAPI.getSupplyGoodsApprovalStateOptions(),
        window.electronAPI.listSupplyGoods({
          fields: [...SUPPLY_GOODS_WORK_ORDER_FIELDS],
          pageNo: 1,
          pageSize: WORK_ORDER_PAGE_SIZE,
          sort: 'modifiedOn:desc',
        }),
      ])
      if (loadRequestRef.current !== requestId) return
      setApprovalOptions(nextApprovalOptions)
      setColumns(buildSupplyGoodsWorkOrderColumns(nextApprovalOptions, getResultRecords(result)))
      setLoadState('success')
    } catch (error) {
      if (loadRequestRef.current !== requestId) return
      console.error('[我的工单] 加载 SupplyGoods 失败:', error)
      setErrorMessage(error instanceof Error ? error.message : '加载工单失败')
      setLoadState('error')
    }
  }, [])

  const loadDetail = React.useCallback(async (recordId: string) => {
    const requestId = detailRequestRef.current + 1
    detailRequestRef.current = requestId
    setDetail(null)
    setDetailState('loading')
    setDetailError('')

    try {
      const record = await window.electronAPI.getSupplyGoods({
        id: recordId,
        fields: [...SUPPLY_GOODS_DETAIL_FIELDS],
      })
      if (detailRequestRef.current !== requestId) return
      setDetail(buildSupplyGoodsWorkOrderDetail(approvalOptions, record))
      setDetailState('success')
    } catch (error) {
      if (detailRequestRef.current !== requestId) return
      console.error('[我的工单] 加载 SupplyGoods 详情失败:', error)
      setDetailError(error instanceof Error ? error.message : '加载工单详情失败')
      setDetailState('error')
    }
  }, [approvalOptions])

  React.useEffect(() => {
    loadWorkOrders().catch(console.error)
    return () => {
      loadRequestRef.current += 1
      detailRequestRef.current += 1
    }
  }, [loadWorkOrders])

  React.useEffect(() => {
    if (!selectedId) return
    loadDetail(selectedId).catch(console.error)
  }, [loadDetail, selectedId])

  const loading = loadState === 'loading'

  if (selectedId) {
    return (
      <WorkOrderDetailView
        detail={detail}
        loading={detailState === 'loading'}
        errorMessage={detailState === 'error' ? detailError : ''}
        onBack={() => {
          setSelectedId(null)
          setDetail(null)
          setDetailState('idle')
          setDetailError('')
        }}
        onReload={() => loadDetail(selectedId)}
      />
    )
  }

  return (
    <div className="titlebar-no-drag flex h-full flex-col overflow-hidden bg-[#f3f5f7] text-slate-900">
      <div className="titlebar-drag-region shrink-0 px-8 pt-8 pb-4">
        <div className="mx-auto flex w-full max-w-6xl items-start justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-semibold leading-7 text-slate-950">我的工单</h1>
            <p className="mt-1 text-[12px] leading-5 text-slate-500">当前账号相关的处理记录</p>
          </div>

          <button
            type="button"
            onClick={loadWorkOrders}
            disabled={loading}
            className="titlebar-no-drag inline-flex size-8 items-center justify-center rounded-md bg-white text-slate-500 shadow-sm transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="刷新工单"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-8 pb-8">
        <div className="mx-auto flex w-full max-w-6xl gap-4 overflow-x-auto pb-2">
          {columns.map((column) => (
            <WorkOrderColumn
              key={column.id}
              column={column}
              loading={loading}
              onOpen={setSelectedId}
            />
          ))}
        </div>

        {loadState === 'error' ? (
          <InlineError message={errorMessage} />
        ) : null}
      </div>
    </div>
  )
}

interface WorkOrderColumnProps {
  column: SupplyGoodsWorkOrderColumn
  loading: boolean
  onOpen: (recordId: string) => void
}

function WorkOrderColumn({ column, loading, onOpen }: WorkOrderColumnProps): React.ReactElement {
  const tone = getColumnTone(column.stateValue)

  return (
    <section className="w-[280px] shrink-0">
      <div className="mb-3 flex h-7 items-center gap-2">
        <h2 className="text-[13px] font-semibold text-slate-800">{column.title}</h2>
        <span className={cn('inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-5', tone.countClassName)}>
          {loading ? '...' : column.cards.length}
        </span>
      </div>

      <div className="space-y-3">
        {loading ? (
          <WorkOrderSkeletonList />
        ) : column.cards.length > 0 ? (
          column.cards.map((card) => (
            <WorkOrderCard key={card.id} card={card} onOpen={onOpen} />
          ))
        ) : (
          <div className="flex h-28 items-center justify-center rounded-lg bg-white text-[12px] text-slate-400 shadow-sm">
            暂无{column.title}
          </div>
        )}
      </div>
    </section>
  )
}

interface WorkOrderCardProps {
  card: SupplyGoodsWorkOrderCard
  onOpen: (recordId: string) => void
}

function WorkOrderCard({ card, onOpen }: WorkOrderCardProps): React.ReactElement {
  const completed = card.stateValue >= 10
  const meta = [card.cityLabel, card.groupLabel].filter(Boolean).join(' · ')
  const tone = getColumnTone(card.stateValue)

  return (
    <button
      type="button"
      onClick={() => onOpen(card.id)}
      className={cn(
        'block w-full min-h-[98px] rounded-lg bg-white px-4 py-3 text-left shadow-sm transition',
        completed ? 'opacity-70 hover:opacity-90' : 'hover:-translate-y-0.5 hover:shadow-md'
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-slate-400">{card.code}</div>
          <h3 className="mt-2 truncate text-[13px] font-semibold leading-5 text-slate-900">{card.title}</h3>
        </div>

        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', tone.pillClassName)}>
          <span className={cn('size-1 rounded-full', tone.dotClassName)} />
          {card.statusLabel}
        </span>
      </div>

      <p className="mt-1 truncate text-[12px] leading-5 text-slate-500">{card.subtitle || meta || card.stateLabel}</p>

      <div className={cn('mt-2 flex items-center gap-1.5 text-[11px] font-medium', completed ? 'text-slate-400' : 'text-orange-600')}>
        {completed ? <Check className="size-3.5" /> : <Clock3 className="size-3.5" />}
        <span>{card.timeLabel}</span>
      </div>
    </button>
  )
}

interface WorkOrderDetailViewProps {
  detail: SupplyGoodsWorkOrderDetail | null
  loading: boolean
  errorMessage: string
  onBack: () => void
  onReload: () => void
}

function WorkOrderDetailView({
  detail,
  loading,
  errorMessage,
  onBack,
  onReload,
}: WorkOrderDetailViewProps): React.ReactElement {
  return (
    <div className="titlebar-no-drag flex h-full overflow-hidden bg-[#f3f5f7] text-slate-900">
      <div className="min-w-0 flex-1 overflow-auto px-8 py-7">
        <div className="mx-auto w-full max-w-5xl">
          <button
            type="button"
            onClick={onBack}
            className="mb-4 inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 transition hover:text-slate-900"
          >
            <ArrowLeft className="size-3.5" />
            我的工单
          </button>

          {loading ? (
            <DetailSkeleton />
          ) : detail ? (
            <DetailMain detail={detail} />
          ) : errorMessage ? (
            <InlineError message={errorMessage} />
          ) : null}
        </div>
      </div>

      <aside className="w-[300px] shrink-0 overflow-auto border-l border-slate-200/70 bg-white px-5 py-7">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[12px] font-semibold text-slate-500">工单属性</div>
          <button
            type="button"
            onClick={onReload}
            disabled={loading}
            className="inline-flex size-7 items-center justify-center rounded-md bg-slate-100 text-slate-500 transition hover:text-slate-900 disabled:opacity-50"
            aria-label="刷新详情"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          </button>
        </div>

        {detail ? (
          <DetailSideBar detail={detail} />
        ) : (
          <div className="rounded-lg bg-slate-50 px-4 py-5 text-[12px] text-slate-400">加载详情中</div>
        )}
      </aside>
    </div>
  )
}

function DetailMain({ detail }: { detail: SupplyGoodsWorkOrderDetail }): React.ReactElement {
  const tone = getColumnTone(detail.header.stateValue)

  return (
    <div className="space-y-5">
      <div>
        <div className="text-[11px] font-medium text-slate-400">{detail.header.code} · {detail.header.stateLabel}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-[20px] font-semibold leading-7 text-slate-950">{detail.header.title}</h1>
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', tone.pillClassName)}>
            <span className={cn('size-1 rounded-full', tone.dotClassName)} />
            {detail.header.stateLabel}
          </span>
        </div>
        <p className="mt-1 text-[13px] leading-5 text-slate-600">{detail.header.subtitle}</p>
      </div>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[14px] font-semibold text-slate-900">商品提报基础信息</h2>
            <p className="mt-1 text-[12px] leading-5 text-slate-500">从 SupplyGoods、提报公司与提报商户字段匹配出的核心信息。</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700">当前节点：{detail.header.stateLabel}</span>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {detail.baseSections.map((section) => (
            <InfoPanel key={section.title} section={section} />
          ))}
        </div>
      </section>

      <DetailListCard title="销售提报完整性" items={detail.completenessItems} columns={2} />
      <DetailListCard title="资质与经营类目" items={detail.businessItems} columns={1} />
      <DetailListCard title="Agent 检查结果" items={detail.checkItems} columns={1} />

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="text-[14px] font-semibold text-slate-900">协作动态</h2>
        <div className="mt-4 space-y-3">
          {detail.activityItems.map((item) => (
            <div key={item.label} className="flex gap-3 text-[12px]">
              <div className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <MessageSquare className="size-3" />
              </div>
              <div>
                <div className="font-medium text-slate-700">{item.label}</div>
                <div className="mt-0.5 text-slate-400">{item.value}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function InfoPanel({ section }: { section: SupplyGoodsDetailSection }): React.ReactElement {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-3">
      <div className="text-[12px] font-semibold text-slate-900">{section.title}</div>
      <div className="mt-1 text-[11px] leading-4 text-slate-400">{section.description}</div>
      <div className="mt-3 space-y-1.5">
        {section.items.map((item) => (
          <div key={item.label} className="flex justify-between gap-3 text-[11px]">
            <span className="shrink-0 text-slate-400">{item.label}</span>
            <span className="min-w-0 truncate text-right font-medium text-slate-700">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DetailListCard({ title, items, columns }: { title: string; items: SupplyGoodsDetailValue[]; columns: 1 | 2 }): React.ReactElement {
  return (
    <section className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="text-[14px] font-semibold text-slate-900">{title}</h2>
      <div className={cn('mt-4 grid gap-2', columns === 2 ? 'md:grid-cols-2' : 'grid-cols-1')}>
        {items.map((item) => {
          const ready = item.value !== '未上传' && item.value !== '未提供'
          return (
            <div key={item.label} className={cn('flex items-center justify-between gap-3 rounded-md px-3 py-2 text-[12px]', ready ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500')}>
              <span className="truncate">{item.label}</span>
              <span className="inline-flex shrink-0 items-center gap-1 font-medium">
                {ready ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                {item.value}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function DetailSideBar({ detail }: { detail: SupplyGoodsWorkOrderDetail }): React.ReactElement {
  const approvalUrl = buildSupplyGoodsApprovalUrl(detail.header.id)

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {detail.attributeItems.map((item) => (
          <div key={item.label} className="grid grid-cols-[72px_1fr] gap-3 text-[12px]">
            <span className="text-slate-400">{item.label}</span>
            <span className="min-w-0 truncate text-right font-medium text-slate-700">{item.value}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 pt-4">
        <div className="mb-3 text-[12px] font-semibold text-slate-500">流转进度</div>
        <div className="space-y-2">
          {detail.progressItems.map((item, index) => (
            <div key={item.label} className="flex items-center gap-2 text-[12px]">
              <span className={cn('inline-flex size-5 items-center justify-center rounded-full text-[10px] font-semibold', item.active ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400')}>
                {index + 1}
              </span>
              <span className={cn(item.active ? 'font-semibold text-emerald-700' : 'text-slate-500')}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg bg-violet-50 px-4 py-3 text-[12px] text-violet-700">
        <div className="mb-2 flex items-center gap-1.5 font-semibold">
          <Sparkles className="size-3.5" />
          Agent 分析
        </div>
        已根据提报资料、证照附件与商品字段生成核验建议，后续可接入流转记录补全处理轨迹。
      </div>

      <a
        href={approvalUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 text-[12px] font-semibold text-white shadow-sm transition hover:bg-emerald-700"
      >
        <Share2 className="size-3.5" />
        跳转审批
      </a>
    </div>
  )
}

function getColumnTone(stateValue: number): { countClassName: string; pillClassName: string; dotClassName: string } {
  if (stateValue === 2) {
    return {
      countClassName: 'bg-orange-100 text-orange-600',
      pillClassName: 'bg-orange-50 text-orange-600 ring-1 ring-orange-200',
      dotClassName: 'bg-orange-500',
    }
  }

  if (stateValue === 10) {
    return {
      countClassName: 'bg-emerald-100 text-emerald-700',
      pillClassName: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
      dotClassName: 'bg-emerald-500',
    }
  }

  if (stateValue >= 11) {
    return {
      countClassName: 'bg-rose-100 text-rose-600',
      pillClassName: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200',
      dotClassName: 'bg-rose-500',
    }
  }

  return {
    countClassName: 'bg-slate-200 text-slate-600',
    pillClassName: 'bg-slate-100 text-slate-500',
    dotClassName: 'bg-slate-400',
  }
}

function InlineError({ message }: { message: string }): React.ReactElement {
  return (
    <div className="mx-auto mt-5 flex w-full max-w-6xl items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-[12px] text-red-700 shadow-sm">
      <AlertCircle className="size-4 shrink-0" />
      <span className="line-clamp-2">{message}</span>
    </div>
  )
}

function WorkOrderSkeletonList(): React.ReactElement {
  return (
    <>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-[98px] animate-pulse rounded-lg bg-white px-4 py-3 shadow-sm">
          <div className="h-3 w-14 rounded bg-slate-100" />
          <div className="mt-4 h-4 w-2/3 rounded bg-slate-100" />
          <div className="mt-3 h-3 w-1/2 rounded bg-slate-100" />
          <div className="mt-3 h-3 w-24 rounded bg-slate-100" />
        </div>
      ))}
    </>
  )
}

function DetailSkeleton(): React.ReactElement {
  return (
    <div className="space-y-5">
      <div className="h-20 animate-pulse rounded-lg bg-white shadow-sm" />
      <div className="h-48 animate-pulse rounded-lg bg-white shadow-sm" />
      <div className="h-28 animate-pulse rounded-lg bg-white shadow-sm" />
      <div className="h-36 animate-pulse rounded-lg bg-white shadow-sm" />
    </div>
  )
}
