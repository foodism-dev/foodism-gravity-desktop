import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@proma/shared'

import {
  mergeAgentSessionListsByFreshness,
  replaceAgentSessionInFreshnessOrder,
} from './agent-session-list'

function session(id: string, updatedAt: number, pinned = false): AgentSessionMeta {
  return {
    id,
    title: id,
    updatedAt,
    createdAt: updatedAt,
    pinned,
  }
}

describe('Agent 会话列表合并', () => {
  test('Given local pinned session is newer, When stale refresh arrives, Then pinned state is preserved by session id', () => {
    const current = [session('a', 2000, true), session('b', 1000)]
    const refreshed = [session('a', 1500, false), session('b', 1200)]

    const merged = mergeAgentSessionListsByFreshness(current, refreshed)

    expect(merged.find((item) => item.id === 'a')?.pinned).toBe(true)
    expect(merged.find((item) => item.id === 'a')?.updatedAt).toBe(2000)
    expect(merged.map((item) => item.id)).toEqual(['a', 'b'])
  })

  test('Given refreshed session is newer, When merging, Then refreshed metadata wins', () => {
    const current = [session('a', 1000, true)]
    const refreshed = [session('a', 2000, false)]

    const merged = mergeAgentSessionListsByFreshness(current, refreshed)

    expect(merged).toEqual([session('a', 2000, false)])
  })

  test('Given updated session, When replacing, Then list remains sorted by freshness', () => {
    const replaced = replaceAgentSessionInFreshnessOrder(
      [session('a', 1000), session('b', 2000)],
      session('a', 3000, true),
    )

    expect(replaced.map((item) => item.id)).toEqual(['a', 'b'])
    expect(replaced[0]?.pinned).toBe(true)
  })
})
