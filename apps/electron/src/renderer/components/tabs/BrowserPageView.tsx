/**
 * 浏览器式页面容器。
 *
 * 使用 Electron webview 承载外部/内嵌业务页面，比 iframe 更接近独立浏览器标签页。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { RefreshCw, type LucideIcon } from 'lucide-react'
import { settingsOpenAtom } from '@/atoms/settings-tab'

export interface BrowserPageViewProps {
  id: string
  title: string
  url: string
  icon: LucideIcon
  iconClassName: string
  reloadLabel: string
  showToolbar?: boolean
  onHostMessage?: (message: unknown) => void
}

export function BrowserPageView({
  id,
  title,
  url,
  icon: Icon,
  iconClassName,
  reloadLabel,
  showToolbar = true,
  onHostMessage,
}: BrowserPageViewProps): React.ReactElement {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const settingsOpen = useAtomValue(settingsOpenAtom)

  const getBounds = React.useCallback(() => {
    const rect = contentRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0, width: 0, height: 0 }
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }
  }, [])

  const syncBounds = React.useCallback(() => {
    if (settingsOpen) return
    window.electronAPI.browserTabSetBounds({ id, bounds: getBounds() }).catch((error) => {
      console.error('[业务浏览器] 同步页面位置失败:', error)
    })
  }, [getBounds, id, settingsOpen])

  React.useEffect(() => {
    let disposed = false

    window.electronAPI.browserTabEnsure({ id, url, bounds: getBounds() }).catch((error) => {
      console.error('[业务浏览器] 创建页面失败:', error)
    })

    const element = contentRef.current
    const resizeObserver = element
      ? new ResizeObserver(() => {
          if (!disposed) syncBounds()
        })
      : null
    if (element) resizeObserver?.observe(element)
    window.addEventListener('resize', syncBounds)

    return () => {
      disposed = true
      resizeObserver?.disconnect()
      window.removeEventListener('resize', syncBounds)
      window.electronAPI.browserTabHide({ id }).catch((error) => {
        console.error('[业务浏览器] 隐藏页面失败:', error)
      })
    }
  }, [getBounds, id, syncBounds, url])

  React.useEffect(() => {
    if (!onHostMessage) return
    return window.electronAPI.onBrowserTabHostMessage((payload) => {
      if (payload.tabId !== id) return
      onHostMessage(payload.message)
    })
  }, [id, onHostMessage])

  React.useEffect(() => {
    if (settingsOpen) {
      window.electronAPI.browserTabHide({ id }).catch((error) => {
        console.error('[业务浏览器] 设置打开时隐藏页面失败:', error)
      })
      return
    }

    window.electronAPI.browserTabSetBounds({ id, bounds: getBounds() }).catch((error) => {
      console.error('[业务浏览器] 恢复页面位置失败:', error)
    })
    window.electronAPI.browserTabShow({ id }).catch((error) => {
      console.error('[业务浏览器] 设置关闭后显示页面失败:', error)
    })
  }, [getBounds, id, settingsOpen])

  const handleReload = React.useCallback(() => {
    window.electronAPI.browserTabReload({ id }).catch((error) => {
      console.error('[业务浏览器] 刷新页面失败:', error)
    })
  }, [id])

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      {showToolbar ? (
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`flex size-7 shrink-0 items-center justify-center rounded-md ${iconClassName}`}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-slate-900">{title}</div>
              <div className="truncate text-[11px] text-slate-400">{url}</div>
            </div>
          </div>
          <button
            type="button"
            aria-label={reloadLabel}
            onClick={handleReload}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <RefreshCw className="size-4" />
          </button>
        </div>
      ) : null}

      <div
        ref={contentRef}
        className="h-full min-h-0 w-full flex-1 bg-white"
      />
    </div>
  )
}
