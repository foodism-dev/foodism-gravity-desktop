/**
 * 登录认证类型
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
  /** 邮箱 */
  email?: string
  /** 脱敏手机号 */
  phoneMasked?: string
  /** 租户标识 */
  tenantId?: string
  /** 工号 */
  employeeNo?: string
  /** 职位 */
  title?: string
}

/** 登录身份来源 */
export type AuthProvider = 'mock' | 'gravity-sso'

/** 当前用户角色摘要 */
export interface AuthRole {
  /** 角色编码 */
  code: string
  /** 角色名称 */
  name: string
  /** 角色来源 */
  source: string
}

/** 外部身份摘要 */
export interface AuthIdentity {
  /** 身份提供方 */
  provider: string
  /** 身份类型 */
  type: string
  /** 状态 */
  status: string
  /** 外部系统标识 */
  externalKey: string
  /** 脱敏手机号 */
  phoneMasked: string
}

/** 登录会话状态 */
export interface AuthSession {
  /** 是否已登录 */
  isAuthenticated: boolean
  /** 登录来源 */
  provider?: AuthProvider
  /** Hono API JWT token */
  apiToken?: string
  /** OIDC access_token */
  accessToken?: string
  /** OIDC refresh_token */
  refreshToken?: string
  /** OIDC id_token */
  idToken?: string
  /** OIDC token_type */
  tokenType?: string
  /** 已登录用户 */
  user?: AuthUser
  /** 角色摘要 */
  roles?: AuthRole[]
  /** 外部身份摘要 */
  identities?: AuthIdentity[]
  /** 登录时间戳 */
  loggedInAt?: string
  /** 过期时间戳 */
  expiresAt?: string
  /** 是否支持刷新 */
  refreshable?: boolean
}

/** SSO 登录启动结果 */
export interface AuthSsoLoginResult {
  ok: true
  authorizeUrl: string
}

/** 登录 IPC 通道 */
export const AUTH_IPC_CHANNELS = {
  GET_SESSION: 'auth:get-session',
  LOGIN: 'auth:login',
  START_SSO_LOGIN: 'auth:start-sso-login',
  SSO_COMPLETED: 'auth:sso-completed',
  SSO_ERROR: 'auth:sso-error',
  LOGOUT: 'auth:logout',
} as const
