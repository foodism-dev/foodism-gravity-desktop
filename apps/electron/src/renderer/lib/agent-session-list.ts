import type { AgentSessionMeta } from '@proma/shared'

/** 按最近更新时间排序 Agent 会话，保持与主进程 listAgentSessions 一致。 */
export function sortAgentSessionsByUpdatedAtDesc(
  sessions: readonly AgentSessionMeta[],
): AgentSessionMeta[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 用后端返回的新元数据替换本地条目，并按最近更新时间重新排序。 */
export function replaceAgentSessionInFreshnessOrder(
  sessions: readonly AgentSessionMeta[],
  updated: AgentSessionMeta,
): AgentSessionMeta[] {
  const others = sessions.filter((session) => session.id !== updated.id)
  return sortAgentSessionsByUpdatedAtDesc([updated, ...others])
}

/**
 * 合并后台刷新回来的会话列表。
 *
 * 置顶、重命名这类交互会立即拿到主进程返回的新 session meta；
 * 但同时可能还有稍早发出的 listAgentSessions() 请求在路上。
 * 如果旧请求后返回，不能用旧 meta 覆盖本地较新的同 ID 会话状态。
 */
export function mergeAgentSessionListsByFreshness(
  current: readonly AgentSessionMeta[],
  refreshed: readonly AgentSessionMeta[],
): AgentSessionMeta[] {
  const currentById = new Map(current.map((session) => [session.id, session]))
  return sortAgentSessionsByUpdatedAtDesc(refreshed.map((session) => {
    const local = currentById.get(session.id)
    if (local && local.updatedAt > session.updatedAt) return local
    return session
  }))
}
