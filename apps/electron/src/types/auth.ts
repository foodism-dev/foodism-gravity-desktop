/**
 * 登录认证类型
 *
 * 当前使用本地 mock 接口，后续可替换为真实后端认证。
 */

/** 登录请求参数 */
export interface LoginInput {
  /** 账号 */
  username: string
  /** 密码 */
  password: string
}

/** 当前登录用户 */
export interface AuthUser {
  /** 用户唯一标识 */
  id: string
  /** 账号 */
  username: string
  /** 展示名称 */
  displayName: string
}

/** 登录会话状态 */
export interface AuthSession {
  /** 是否已登录 */
  isAuthenticated: boolean
  /** 已登录用户 */
  user?: AuthUser
  /** 登录时间戳 */
  loggedInAt?: string
}

/** 登录 IPC 通道 */
export const AUTH_IPC_CHANNELS = {
  GET_SESSION: 'auth:get-session',
  LOGIN: 'auth:login',
  LOGOUT: 'auth:logout',
} as const
