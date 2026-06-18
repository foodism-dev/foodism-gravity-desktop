/**
 * 应用设置服务
 *
 * 管理应用设置（主题模式等）的读写。
 * 存储在 ~/.proma/settings.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { getSettingsPath } from './config-paths'
import { DEFAULT_THEME_MODE, DEFAULT_THEME_STYLE } from '../../types'
import type { AppSettings } from '../../types'

const FOODISM_DEFAULT_CHANNEL_ID = 'foodism-default-relay'
const FOODISM_LEGACY_DEFAULT_CHANNEL_ID = 'foodism-default-openrouter'
const FOODISM_LEGACY_DEEPSEEK_CHANNEL_ID = 'foodism-default-deepseek'
const FOODISM_DEFAULT_MODEL_ID = 'claude-opus-4-6'

function hasDefaultProviderKey(): boolean {
  return Boolean(
    process.env.FOODISM_DEFAULT_RELAY_API_KEY?.trim()
    || process.env.FOODISM_DEFAULT_DEEPSEEK_API_KEY?.trim()
    || process.env.DEEPSEEK_API_KEY?.trim()
    || process.env.FOODISM_DEFAULT_PROVIDER_API_KEY?.trim()
    || process.env.ANTHROPIC_API_KEY?.trim(),
  )
}

function getDefaultSettings(): AppSettings {
  const defaults: AppSettings = {
    themeMode: DEFAULT_THEME_MODE,
    themeStyle: DEFAULT_THEME_STYLE,
    onboardingCompleted: false,
    environmentCheckSkipped: false,
    notificationsEnabled: true,
    feishuSessionMirror: { mode: 'off' },
  }

  if (hasDefaultProviderKey()) {
    defaults.agentChannelId = FOODISM_DEFAULT_CHANNEL_ID
    defaults.agentModelId = process.env.FOODISM_DEFAULT_MODEL_ID?.trim() || FOODISM_DEFAULT_MODEL_ID
    defaults.agentChannelIds = [FOODISM_DEFAULT_CHANNEL_ID]
  }

  return defaults
}

function applyDefaultProviderSettings(settings: AppSettings): AppSettings {
  if (!hasDefaultProviderKey()) return settings

  return {
    ...settings,
    agentChannelId: FOODISM_DEFAULT_CHANNEL_ID,
    agentModelId: process.env.FOODISM_DEFAULT_MODEL_ID?.trim() || FOODISM_DEFAULT_MODEL_ID,
    agentChannelIds: [
      FOODISM_DEFAULT_CHANNEL_ID,
      ...(settings.agentChannelIds ?? []).filter((id) => (
        id !== FOODISM_DEFAULT_CHANNEL_ID
        && id !== FOODISM_LEGACY_DEFAULT_CHANNEL_ID
        && id !== FOODISM_LEGACY_DEEPSEEK_CHANNEL_ID
      )),
    ],
  }
}

/**
 * 获取应用设置
 *
 * 如果文件不存在，返回默认设置。
 */
export function getSettings(): AppSettings {
  const filePath = getSettingsPath()

  if (!existsSync(filePath)) {
    return getDefaultSettings()
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as Partial<AppSettings>
    return applyDefaultProviderSettings({
      ...data,
      themeMode: data.themeMode || DEFAULT_THEME_MODE,
      themeStyle: data.themeStyle ?? DEFAULT_THEME_STYLE,
      onboardingCompleted: data.onboardingCompleted ?? false,
      environmentCheckSkipped: data.environmentCheckSkipped ?? false,
      notificationsEnabled: data.notificationsEnabled ?? true,
      feishuSessionMirror: data.feishuSessionMirror ?? { mode: 'off' },
    })
  } catch (error) {
    console.error('[设置] 读取失败:', error)
    return getDefaultSettings()
  }
}

/**
 * 更新应用设置
 *
 * 合并更新字段并写入文件。
 */
export function updateSettings(updates: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const updated: AppSettings = {
    ...current,
    ...updates,
  }

  const filePath = getSettingsPath()

  try {
    writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8')
    console.log('[设置] 已更新 keys:', Object.keys(updates).join(', '))
  } catch (error) {
    console.error('[设置] 写入失败:', error)
    throw new Error('写入应用设置失败')
  }

  return updated
}
