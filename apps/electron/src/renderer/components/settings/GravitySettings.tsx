/**
 * GravitySettings - 万店引力设置页
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { Loader2, LogOut, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { authSessionAtom } from '@/atoms/auth'
import { Button } from '@/components/ui/button'
import { fetchCurrentPortalMe } from '@/lib/server-api'
import type { ApiUserInfo, PortalMeResponse } from '@/lib/server-api'
import { SettingsCard, SettingsRow, SettingsSection } from './primitives'

interface DisplayItem {
  label: string
  value: string
}

export function GravitySettings(): React.ReactElement {
  const [authSession, setAuthSession] = useAtom(authSessionAtom)
  const [loading, setLoading] = React.useState(false)
  const [loggingOut, setLoggingOut] = React.useState(false)
  const [response, setResponse] = React.useState<PortalMeResponse | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const loadPortalData = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    setErrorMessage(null)

    try {
      setResponse(await fetchCurrentPortalMe(authSession.apiToken))
    } catch (error) {
      console.warn('[万店引力] 获取 Portal 数据失败:', error)
      setErrorMessage(error instanceof Error ? error.message : '获取 Portal 数据失败')
    } finally {
      setLoading(false)
    }
  }, [authSession.apiToken])

  React.useEffect(() => {
    loadPortalData().catch(() => {})
  }, [loadPortalData])

  const handleLogout = async (): Promise<void> => {
    setLoggingOut(true)
    try {
      const session = await window.electronAPI.logout()
      setAuthSession(session)
      toast.success('已退出登录')
    } catch (error) {
      console.error('[万店引力] 退出登录失败:', error)
      toast.error(error instanceof Error ? error.message : '退出登录失败')
    } finally {
      setLoggingOut(false)
    }
  }

  const user = response?.user ?? authSession.user
  const portalItems = React.useMemo(() => buildPortalItems(response), [response])

  return (
    <div className="space-y-5">
      <SettingsSection
        title="万店引力"
        action={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => loadPortalData().catch(() => {})}
              disabled={loading || loggingOut}
            >
              {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              刷新
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleLogout().catch(() => {})}
              disabled={loggingOut}
            >
              {loggingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
              退出登录
            </Button>
          </div>
        }
      >
        <SettingsCard>
          <SettingsRow label="账号">
            <span className="text-[13px] text-foreground/75">{formatUser(user)}</span>
          </SettingsRow>
          <SettingsRow label="连接状态">
            <span className={errorMessage ? 'text-[13px] text-destructive' : 'text-[13px] text-emerald-600 dark:text-emerald-300'}>
              {errorMessage ?? (loading ? '读取中' : '已连接')}
            </span>
          </SettingsRow>
          {portalItems.length > 0 ? (
            portalItems.map((item) => (
              <SettingsRow key={item.label} label={item.label}>
                <span className="max-w-[360px] truncate text-right text-[13px] text-foreground/75">
                  {item.value}
                </span>
              </SettingsRow>
            ))
          ) : (
            <SettingsRow label="Portal">
              <span className="text-[13px] text-muted-foreground">
                {loading ? '读取中' : '暂无数据'}
              </span>
            </SettingsRow>
          )}
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}

function formatUser(user?: ApiUserInfo): string {
  if (!user) return '未登录'
  return user.displayName || user.username || user.id
}

function buildPortalItems(response: PortalMeResponse | null): DisplayItem[] {
  const payload = getPortalPayload(response)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []

  return Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== null)
    .slice(0, 6)
    .map(([key, value]) => ({
      label: formatFieldLabel(key),
      value: stringifyValue(value),
    }))
}

function getPortalPayload(response: PortalMeResponse | null): unknown {
  if (!response) return null
  if (response.portal) return response.portal
  if (response.portals) return response.portals

  const entries = Object.entries(response).filter(([key]) => key !== 'user')
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function formatFieldLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
}
