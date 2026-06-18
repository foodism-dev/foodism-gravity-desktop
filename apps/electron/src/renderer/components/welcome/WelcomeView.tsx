/**
 * WelcomeView — 主区域空状态启动器
 *
 * 当没有打开任何标签页时：
 * 1. 优先复用现有会话（打开最近的一个）
 * 2. 没有现有会话时，创建一个 draft 会话（不在侧边栏显示）
 *
 * 这样用户直接看到完整的 AgentView（含全功能输入框），
 * 发送第一条消息后 draft 标记自动移除，会话出现在侧边栏。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Loader2 } from 'lucide-react'
import { currentAgentWorkspaceIdAtom, agentSettingsReadyAtom } from '@/atoms/agent-atoms'
import { tabsAtom, activeTabIdAtom, openTab } from '@/atoms/tab-atoms'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { useCreateSession } from '@/hooks/useCreateSession'

export function WelcomeView(): React.ReactElement {
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const agentSettingsReady = useAtomValue(agentSettingsReadyAtom)
  const draftSessionIds = useAtomValue(draftSessionIdsAtom)
  const [tabs, setTabs] = useAtom(tabsAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const { createAgent } = useCreateSession()
  const initRef = React.useRef<string | null>(null)

  // 将高频变化的值收集到 ref 中，避免污染 useEffect 依赖数组（否则 tabs/draftSessionIds
  // 引用变化会导致重复触发，而 createAgent 每次渲染都是新引用）
  const latestRef = React.useRef({
    tabs,
    draftSessionIds,
    currentWorkspaceId,
    setTabs,
    setActiveTabId,
    createAgent,
  })
  latestRef.current = {
    tabs,
    draftSessionIds,
    currentWorkspaceId,
    setTabs,
    setActiveTabId,
    createAgent,
  }

  React.useEffect(() => {
    if (initRef.current === 'agent') return
    // Agent 需等待 settings 就绪（workspaceId 等异步加载完成）
    if (!agentSettingsReady) return

    // 标记当前请求，用于取消过期的异步回调
    initRef.current = 'agent'

    // 从后端 IPC 拿最新数据，避免 HMR 导致 atoms 重置为空时重复创建会话
    window.electronAPI.listAgentSessions().then((freshSessions) => {
      if (initRef.current !== 'agent') return
      const {
        tabs: currentTabs,
        draftSessionIds: currentDrafts,
        currentWorkspaceId: currentWs,
        setTabs: currentSetTabs,
        setActiveTabId: currentSetActiveTabId,
        createAgent: currentCreateAgent,
      } = latestRef.current

      // Agent 模式：按当前工作区过滤
      const existing = freshSessions.find(
        (s) => !s.archived && s.workspaceId === currentWs && !currentDrafts.has(s.id),
      )
      if (existing) {
        const result = openTab(currentTabs, {
          type: 'agent',
          sessionId: existing.id,
          title: existing.title,
        })
        currentSetTabs(result.tabs)
        currentSetActiveTabId(result.activeTabId)
        return
      }

      const draftSession = freshSessions.find(
        (s) => !s.archived && s.workspaceId === currentWs && currentDrafts.has(s.id),
      )
      if (draftSession) {
        const result = openTab(currentTabs, {
          type: 'agent',
          sessionId: draftSession.id,
          title: draftSession.title,
        })
        currentSetTabs(result.tabs)
        currentSetActiveTabId(result.activeTabId)
        return
      }

      currentCreateAgent({ draft: true })
    }).catch(console.error)
  }, [agentSettingsReady])

  // 短暂的过渡状态（通常几十毫秒内就会被 TabContent 替换）
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground/40" />
    </div>
  )
}
