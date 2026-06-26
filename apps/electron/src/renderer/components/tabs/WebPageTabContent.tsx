/**
 * 通用网页 Tab 内容。
 *
 * 用于承载 RB 审核等外部业务页面，避免跳出桌面端工作区。
 */

import * as React from 'react'
import { ExternalLink } from 'lucide-react'
import { createWebTabId } from '@/atoms/tab-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import { buildBrowserTabTitle, isOpenBrowserTabMessage } from '@/lib/browser-tab-host-message'
import { BrowserPageView } from './BrowserPageView'

export interface WebPageTabContentProps {
  title: string
  url: string
}

export function WebPageTabContent({ title, url }: WebPageTabContentProps): React.ReactElement {
  const openSession = useOpenSession()
  const handleHostMessage = React.useCallback((message: unknown): void => {
    if (!isOpenBrowserTabMessage(message)) return
    openSession('web', message.url, buildBrowserTabTitle(message.url))
  }, [openSession])

  return (
    <BrowserPageView
      id={createWebTabId(url)}
      title={title}
      url={url}
      icon={ExternalLink}
      iconClassName="bg-sky-50 text-sky-700"
      reloadLabel={`刷新${title}`}
      onHostMessage={handleHostMessage}
    />
  )
}
