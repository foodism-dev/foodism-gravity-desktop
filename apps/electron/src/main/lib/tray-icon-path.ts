import { existsSync } from 'node:fs'
import { join } from 'node:path'

type FileExists = (path: string) => boolean

/**
 * 解析菜单栏图标路径。
 * 优先使用彩色 logo，保留旧 Template 图标作为资源缺失时的兜底。
 */
export function resolveTrayIconPath(
  resourcesDir: string,
  fileExists: FileExists = existsSync,
): string | null {
  const logoDir = join(resourcesDir, 'proma-logos')
  const candidates = [
    join(logoDir, 'tray-logo.png'),
    join(logoDir, 'iconTemplate.png'),
  ]

  return candidates.find((path) => fileExists(path)) ?? null
}
