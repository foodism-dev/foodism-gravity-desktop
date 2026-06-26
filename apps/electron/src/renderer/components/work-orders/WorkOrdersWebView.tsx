/**
 * 我的工单 Web 视图
 *
 * 在桌面端右侧工作区内嵌 frontend 工单台，避免跳出到系统浏览器。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { MonitorUp } from 'lucide-react'
import { authSessionAtom } from '@/atoms/auth'
import { useOpenSession } from '@/hooks/useOpenSession'
import { WORK_ORDERS_TAB_ID } from '@/atoms/tab-atoms'
import { BrowserPageView } from '@/components/tabs/BrowserPageView'
import { buildBrowserTabTitle, isOpenBrowserTabMessage } from '@/lib/browser-tab-host-message'
import { buildRebuildApprovalTab, buildWorkOrderWebUrl } from '@/lib/work-order-navigation'

interface StartSsoLoginMessage {
  type: 'proma:start-sso-login'
}

interface OpenRebuildApprovalMessage {
  type: 'proma:open-rebuild-approval'
  supplyGoodsId: string
}

function isStartSsoLoginMessage(value: unknown): value is StartSsoLoginMessage {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'proma:start-sso-login'
}

function isOpenRebuildApprovalMessage(value: unknown): value is OpenRebuildApprovalMessage {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'proma:open-rebuild-approval'
    && 'supplyGoodsId' in value
    && typeof value.supplyGoodsId === 'string'
    && value.supplyGoodsId.trim().length > 0
}

export function WorkOrdersWebView(): React.ReactElement {
  const authSession = useAtomValue(authSessionAtom)
  const openSession = useOpenSession()
  const workOrderWebUrl = React.useMemo(
    () => buildWorkOrderWebUrl(import.meta.env.VITE_PROMA_WORK_ORDERS_URL, {
      apiToken: authSession.apiToken,
    }),
    [authSession.apiToken],
  )

  const handleHostMessage = React.useCallback((message: unknown): void => {
    if (isOpenBrowserTabMessage(message)) {
      openSession('web', message.url, buildBrowserTabTitle(message.url))
      return
    }
    if (!isStartSsoLoginMessage(message) && !isOpenRebuildApprovalMessage(message)) return
    if (isStartSsoLoginMessage(message)) {
      window.electronAPI.startSsoLogin().catch((error) => {
        console.error('[我的工单] 打开 SSO 登录页失败:', error)
      })
      return
    }
    const tab = buildRebuildApprovalTab(message.supplyGoodsId.trim())
    openSession(tab.type, tab.sessionId, tab.title)
  }, [openSession])

  return (
    <BrowserPageView
      id={WORK_ORDERS_TAB_ID}
      title="我的工单"
      url={workOrderWebUrl}
      icon={MonitorUp}
      iconClassName="bg-emerald-50 text-emerald-700"
      reloadLabel="刷新我的工单"
      onHostMessage={handleHostMessage}
    />
  )
}
