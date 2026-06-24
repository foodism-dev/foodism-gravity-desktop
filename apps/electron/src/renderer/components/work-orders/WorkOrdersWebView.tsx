/**
 * 我的工单 Web 视图
 *
 * 在桌面端右侧工作区内嵌 frontend 工单台，避免跳出到系统浏览器。
 */

import * as React from 'react'
import { MonitorUp, RefreshCw } from 'lucide-react'
import { buildWorkOrderWebUrl } from '@/lib/work-order-navigation'

export function WorkOrdersWebView(): React.ReactElement {
  const workOrderWebUrl = React.useMemo(
    () => buildWorkOrderWebUrl(import.meta.env.VITE_PROMA_WORK_ORDERS_URL),
    [],
  )
  const [reloadKey, setReloadKey] = React.useState(0)

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
            <MonitorUp className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-slate-900">我的工单</div>
            <div className="truncate text-[11px] text-slate-400">{workOrderWebUrl}</div>
          </div>
        </div>
        <button
          type="button"
          aria-label="刷新我的工单"
          onClick={() => setReloadKey((current) => current + 1)}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>

      <iframe
        key={reloadKey}
        src={workOrderWebUrl}
        title="我的工单"
        className="h-full min-h-0 w-full flex-1 border-0 bg-white"
        sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
      />
    </div>
  )
}
