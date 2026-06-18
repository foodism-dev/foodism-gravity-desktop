/**
 * App Mode Atom - 应用模式状态
 *
 * 产品入口只保留 Agent 模式；chat/scratch 仅作为旧数据兼容值存在。
 */

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

export type AppMode = 'chat' | 'agent' | 'scratch'
type AppModeUpdate = AppMode | ((previous: AppMode) => AppMode)

/** 将旧版持久化模式统一收敛到 Agent。 */
export function normalizeAppMode(_mode: AppMode | null | undefined): AppMode {
  return 'agent'
}

const storedAppModeAtom = atomWithStorage<AppMode>('proma-app-mode', 'agent')

/** App 模式，自动持久化到 localStorage，并兼容旧版 chat/scratch 值。 */
export const appModeAtom = atom(
  (get) => normalizeAppMode(get(storedAppModeAtom)),
  (get, set, update: AppModeUpdate) => {
    const previous = normalizeAppMode(get(storedAppModeAtom))
    const next = typeof update === 'function' ? update(previous) : update
    set(storedAppModeAtom, normalizeAppMode(next))
  },
)
