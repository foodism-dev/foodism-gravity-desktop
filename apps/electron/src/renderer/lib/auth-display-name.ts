import type { AuthUser } from '../../types'

interface AuthDisplayNameInput {
  authUser?: AuthUser
  fallbackName?: string
}

export function getAuthDisplayName(input: AuthDisplayNameInput): string {
  const displayName = input.authUser?.displayName.trim()
  if (displayName) return displayName

  const username = input.authUser?.username.trim()
  if (username) return username

  const fallbackName = input.fallbackName?.trim()
  return fallbackName || '用户'
}
