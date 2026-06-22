/**
 * Installer Manifest 客户端
 *
 * 从 proma-api 的 /api/v1/installers/manifest 接口拉取第三方安装包清单，
 * 带 5 分钟缓存和内置 fallback——断网或接口不可用时至少能拿到内置镜像 URL。
 */

import type { InstallerManifest, InstallerSource } from '@proma/shared'

const PROMA_API_BASE = 'https://api.proma.cool'
const MANIFEST_URL = `${PROMA_API_BASE}/api/v1/installers/manifest`
const CACHE_TTL_MS = 5 * 60 * 1000
const GIT_FOR_WINDOWS_VERSION = '2.54.0'
const GIT_FOR_WINDOWS_RELEASE_TAG = `v${GIT_FOR_WINDOWS_VERSION}.windows.1`

interface GitInstallerMetadata {
  filename: string
  sha256: string
  sizeBytes: number
}

const GIT_FOR_WINDOWS_METADATA: Record<'x64' | 'arm64', GitInstallerMetadata> = {
  x64: {
    filename: 'Git-2.54.0-64-bit.exe',
    sha256: '2b96e7854f0520f0f6b709c21041d9801b1be44d5e1a0d9fa621b2fbc40f1983',
    sizeBytes: 65175776,
  },
  arm64: {
    filename: 'Git-2.54.0-arm64.exe',
    sha256: '97bf63e5c65152c14b488e191c107aa1ccbeae2435690693241be4b2b5edd0d2',
    sizeBytes: 63430440,
  },
}

interface ManifestCache {
  data: InstallerManifest
  timestamp: number
}

let cache: ManifestCache | null = null

/**
 * 内置 fallback manifest。
 *
 * 断网或 API 不可达时使用。Git for Windows 只走国内常用镜像；
 * sha256 留空时下载器会跳过校验并打 warning。
 */
const BUILTIN_FALLBACK: InstallerManifest = {
  installers: [
    {
      id: 'git-for-windows',
      platform: 'win32',
      arch: 'x64',
      version: GIT_FOR_WINDOWS_VERSION,
      downloadUrl: getGitForWindowsMirrorUrl('x64'),
      fallbackUrl: '',
      sha256: GIT_FOR_WINDOWS_METADATA.x64.sha256,
      sizeBytes: GIT_FOR_WINDOWS_METADATA.x64.sizeBytes,
      filename: GIT_FOR_WINDOWS_METADATA.x64.filename,
    },
    {
      id: 'git-for-windows',
      platform: 'win32',
      arch: 'arm64',
      version: GIT_FOR_WINDOWS_VERSION,
      downloadUrl: getGitForWindowsMirrorUrl('arm64'),
      fallbackUrl: '',
      sha256: GIT_FOR_WINDOWS_METADATA.arm64.sha256,
      sizeBytes: GIT_FOR_WINDOWS_METADATA.arm64.sizeBytes,
      filename: GIT_FOR_WINDOWS_METADATA.arm64.filename,
    },
    {
      id: 'nodejs',
      platform: 'win32',
      arch: 'x64',
      version: '22.13.1',
      downloadUrl: '',
      fallbackUrl: 'https://nodejs.org/dist/v22.13.1/node-v22.13.1-x64.msi',
      sha256: '',
      sizeBytes: 28000000,
      filename: 'node-v22.13.1-x64.msi',
    },
    {
      id: 'nodejs',
      platform: 'win32',
      arch: 'arm64',
      version: '22.13.1',
      downloadUrl: '',
      fallbackUrl: 'https://nodejs.org/dist/v22.13.1/node-v22.13.1-arm64.msi',
      sha256: '',
      sizeBytes: 28000000,
      filename: 'node-v22.13.1-arm64.msi',
    },
  ],
}

function getGitForWindowsMirrorUrl(arch: 'x64' | 'arm64'): string {
  return `https://npmmirror.com/mirrors/git-for-windows/${GIT_FOR_WINDOWS_RELEASE_TAG}/${GIT_FOR_WINDOWS_METADATA[arch].filename}`
}

function normalizeInstallerSource(source: InstallerSource): InstallerSource {
  if (source.id !== 'git-for-windows') {
    return source
  }

  const metadata = GIT_FOR_WINDOWS_METADATA[source.arch]
  return {
    ...source,
    version: GIT_FOR_WINDOWS_VERSION,
    downloadUrl: getGitForWindowsMirrorUrl(source.arch),
    fallbackUrl: '',
    sha256: metadata.sha256,
    sizeBytes: metadata.sizeBytes,
    filename: metadata.filename,
  }
}

/**
 * 标准化远程清单，确保 Git for Windows 始终优先使用国内镜像，
 * 避免服务端清单尚未更新时客户端继续走旧 CDN。
 */
export function normalizeInstallerManifest(
  manifest: InstallerManifest,
): InstallerManifest {
  return {
    installers: manifest.installers.map((installer) =>
      normalizeInstallerSource(installer),
    ),
  }
}

/**
 * 获取内置 fallback 清单副本，避免调用方意外修改模块级常量。
 */
export function getBuiltinInstallerManifest(): InstallerManifest {
  return normalizeInstallerManifest({
    installers: BUILTIN_FALLBACK.installers.map((installer) => ({ ...installer })),
  })
}

/**
 * 拉取安装包清单（优先远程，失败回退内置）
 */
export async function fetchInstallerManifest(force = false): Promise<InstallerManifest> {
  if (!force && cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.data
  }

  try {
    const response = await fetch(MANIFEST_URL, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Proma-Desktop-App',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = (await response.json()) as InstallerManifest
    if (!data || !Array.isArray(data.installers)) {
      throw new Error('Manifest format invalid')
    }

    const normalizedData = normalizeInstallerManifest(data)
    cache = { data: normalizedData, timestamp: Date.now() }
    console.log(`[Installer Manifest] 远程清单获取成功，共 ${normalizedData.installers.length} 项`)
    return normalizedData
  } catch (error) {
    console.warn(
      `[Installer Manifest] 远程清单获取失败，降级到内置 fallback:`,
      error,
    )
    // 不缓存 fallback，下一次仍然先试远程
    return getBuiltinInstallerManifest()
  }
}

/**
 * 从清单中挑出匹配指定 (id, arch) 的条目
 */
export function findInstallerSource(
  manifest: InstallerManifest,
  id: string,
  arch: 'x64' | 'arm64',
): InstallerSource | undefined {
  return manifest.installers.find((s) => s.id === id && s.arch === arch)
}
