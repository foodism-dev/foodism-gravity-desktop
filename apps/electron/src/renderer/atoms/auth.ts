/**
 * Auth Atom - 登录状态
 *
 * 管理 mock 登录会话，通过 IPC 从主进程加载/保存。
 */

import { atom } from 'jotai'
import type { AuthSession } from '../../types'

/** 当前登录会话 */
export const authSessionAtom = atom<AuthSession>({ isAuthenticated: false })
