import { atom } from 'jotai'
import type { ApiUserInfo } from '@/lib/server-api'

/** Hono API 返回的当前用户信息 */
export const apiUserInfoAtom = atom<ApiUserInfo | null>(null)
