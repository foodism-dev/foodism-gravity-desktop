/**
 * Skill 市场本地安装服务
 *
 * 负责把服务端下载的 .skill 包校验并安装到本地工作区。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import AdmZip from 'adm-zip'
import { getInactiveSkillsDir, getWorkspaceSkillsDir } from './config-paths'
import type { MarketSkillDetail, MarketSkillImportSource, MarketSkillInstallInput, MarketSkillListInput, MarketSkillSummary, SkillMeta } from '@proma/shared'

const SOURCE_META_FILE = '.source.json'
const INSTALL_BLOCKLIST = new Set(['.git', 'node_modules', 'dist', '.next', '.cache', '.turbo', '__pycache__'])

export interface MarketSkillPackageInfo {
  slug: string
  name: string
  packageSha256: string
  packageSizeBytes: number
}

export interface InstallMarketSkillInput {
  workspaceSlug: string
  packagePath: string
  expectedSha256: string
  marketSkill: MarketSkillPackageInfo
}

export type SkillMarketFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface SkillMarketClientOptions {
  baseUrl?: string
  fetchImpl?: SkillMarketFetch
}

interface MarketSkillListResponse {
  skills: MarketSkillSummary[]
}

interface MarketSkillDetailResponse {
  skill: MarketSkillDetail
}

interface MarketSkillDownloadResponse {
  downloadUrl: string
  packageSha256: string
  packageSizeBytes: number
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function getSkillMarketBaseUrl(options: SkillMarketClientOptions): string {
  return normalizeBaseUrl(
    options.baseUrl
    || process.env.API_BASE_URL
    || process.env.PROMA_SERVER_URL
    || process.env.VITE_PROMA_SERVER_URL
    || 'http://localhost:8787'
  )
}

function buildApiUrl(baseUrl: string, path: string, params?: Record<string, string | undefined>): string {
  const url = new URL(path, `${baseUrl}/`)
  for (const [key, value] of Object.entries(params ?? {})) {
    const trimmed = value?.trim()
    if (trimmed) url.searchParams.set(key, trimmed)
  }
  return url.toString()
}

function resolveDownloadUrl(baseUrl: string, downloadUrl: string): string {
  return new URL(downloadUrl, `${baseUrl}/`).toString()
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const payload = await response.json().catch(() => undefined) as unknown
  if (!response.ok) {
    if (typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string') {
      throw new Error(payload.message)
    }
    throw new Error(fallbackMessage)
  }
  return payload as T
}

async function fetchJson<T>(url: string, options: SkillMarketClientOptions, fallbackMessage: string): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(url)
  return readJsonResponse<T>(response, fallbackMessage)
}

function assertInside(parentDir: string, targetPath: string): void {
  const parent = resolve(parentDir)
  const target = resolve(targetPath)
  if (target !== parent && !target.startsWith(parent + sep)) {
    throw new Error('Skill 包路径不安全')
  }
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/')
}

function validateZipEntry(entryName: string, expectedRoot: string): void {
  const normalized = toPosixPath(normalize(entryName))
  const parts = normalized.split('/').filter(Boolean)

  if (!entryName || isAbsolute(entryName) || normalized.startsWith('../') || parts.includes('..')) {
    throw new Error('Skill 包路径不安全')
  }
  if (parts[0] !== expectedRoot) {
    throw new Error(`Skill 包根目录必须是 ${expectedRoot}`)
  }
  if (parts.some((part) => INSTALL_BLOCKLIST.has(part))) {
    throw new Error(`Skill 包包含不允许的目录: ${entryName}`)
  }
}

function extractSkillPackage(packagePath: string, targetRoot: string, expectedRoot: string): void {
  const zip = new AdmZip(packagePath)
  const entries = zip.getEntries()
  let hasSkillMd = false

  for (const entry of entries) {
    validateZipEntry(entry.entryName, expectedRoot)
    const normalized = toPosixPath(normalize(entry.entryName))
    if (normalized.toLowerCase() === `${expectedRoot.toLowerCase()}/skill.md`) {
      hasSkillMd = true
    }
  }

  if (!hasSkillMd) {
    throw new Error('Skill 包缺少 SKILL.md')
  }

  zip.extractAllTo(targetRoot, true)
}

function parseInstalledSkill(skillDir: string, slug: string, enabled: boolean, source: MarketSkillImportSource): SkillMeta {
  const skillMdPath = join(skillDir, 'SKILL.md')
  let content = readFileSync(skillMdPath, 'utf-8')
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)

  const meta: SkillMeta = {
    slug,
    name: slug,
    enabled,
    importSource: source,
  }

  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  const frontmatter = fmMatch?.[1]
  if (!frontmatter) return meta

  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
    if (key === 'name' && value) meta.name = value
    if (key === 'description' && value) meta.description = value
    if (key === 'group' && value) meta.group = value
    if (key === 'icon' && value) meta.icon = value
    if (key === 'version' && value) meta.version = value
  }

  return meta
}

function readMarketSource(skillDir: string): MarketSkillImportSource | null {
  const sourcePath = join(skillDir, SOURCE_META_FILE)
  if (!existsSync(sourcePath)) return null

  try {
    const data = JSON.parse(readFileSync(sourcePath, 'utf-8')) as Partial<MarketSkillImportSource>
    if (data.kind !== 'market' || !data.packageSha256) return null
    return data as MarketSkillImportSource
  } catch {
    return null
  }
}

export function installMarketSkillPackageFromFile(input: InstallMarketSkillInput): SkillMeta {
  const actualSha256 = sha256File(input.packagePath)
  if (actualSha256 !== input.expectedSha256 || actualSha256 !== input.marketSkill.packageSha256) {
    throw new Error('Skill 包校验失败')
  }

  const activeDir = getWorkspaceSkillsDir(input.workspaceSlug)
  const inactiveDir = getInactiveSkillsDir(input.workspaceSlug)
  const activeTarget = join(activeDir, input.marketSkill.slug)
  const inactiveTarget = join(inactiveDir, input.marketSkill.slug)
  const installParent = activeDir
  const tmpRoot = join(installParent, `.${input.marketSkill.slug}.installing`)
  const extractedSkillDir = join(tmpRoot, input.marketSkill.slug)
  const backupTarget = join(installParent, `.${input.marketSkill.slug}.backup`)
  const source: MarketSkillImportSource = {
    kind: 'market',
    slug: input.marketSkill.slug,
    name: input.marketSkill.name,
    packageSha256: input.marketSkill.packageSha256,
    packageSizeBytes: input.marketSkill.packageSizeBytes,
    installedAt: new Date().toISOString(),
  }

  assertInside(activeDir, activeTarget)
  assertInside(inactiveDir, inactiveTarget)
  assertInside(installParent, tmpRoot)
  assertInside(installParent, backupTarget)

  rmSync(tmpRoot, { recursive: true, force: true })
  rmSync(backupTarget, { recursive: true, force: true })
  mkdirSync(tmpRoot, { recursive: true })

  try {
    extractSkillPackage(input.packagePath, tmpRoot, input.marketSkill.slug)
    if (!existsSync(extractedSkillDir)) {
      throw new Error(`Skill 包根目录必须是 ${input.marketSkill.slug}`)
    }
    writeFileSync(join(extractedSkillDir, SOURCE_META_FILE), JSON.stringify(source, null, 2), 'utf-8')

    if (existsSync(inactiveTarget)) {
      rmSync(inactiveTarget, { recursive: true, force: true })
    }
    if (existsSync(activeTarget)) {
      renameSync(activeTarget, backupTarget)
    }
    renameSync(extractedSkillDir, activeTarget)
    rmSync(backupTarget, { recursive: true, force: true })
  } catch (error) {
    rmSync(tmpRoot, { recursive: true, force: true })
    if (!existsSync(activeTarget) && existsSync(backupTarget)) {
      renameSync(backupTarget, activeTarget)
    } else {
      rmSync(backupTarget, { recursive: true, force: true })
    }
    throw error
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true })
  }

  console.log(`[Skill 市场] 已安装 Skill: ${input.workspaceSlug}/${input.marketSkill.slug}`)
  return parseInstalledSkill(activeTarget, input.marketSkill.slug, true, source)
}

export function hasMarketSkillUpdate(workspaceSlug: string, skillSlug: string, remotePackageSha256: string): boolean {
  const candidates = [
    join(getWorkspaceSkillsDir(workspaceSlug), skillSlug),
    join(getInactiveSkillsDir(workspaceSlug), skillSlug),
  ]

  for (const skillDir of candidates) {
    const source = readMarketSource(skillDir)
    if (source) return source.packageSha256 !== remotePackageSha256
  }

  return false
}

export function getMarketSkillInstallPath(workspaceSlug: string, skillSlug: string): string {
  return join(getWorkspaceSkillsDir(workspaceSlug), basename(skillSlug))
}

export async function listMarketSkills(input: MarketSkillListInput = {}, options: SkillMarketClientOptions = {}): Promise<MarketSkillSummary[]> {
  const baseUrl = getSkillMarketBaseUrl(options)
  const response = await fetchJson<MarketSkillListResponse>(
    buildApiUrl(baseUrl, '/api/skills', { query: input.query, tag: input.tag }),
    options,
    '获取 Skill 市场列表失败',
  )
  return response.skills
}

export async function getMarketSkill(slug: string, options: SkillMarketClientOptions = {}): Promise<MarketSkillDetail> {
  const baseUrl = getSkillMarketBaseUrl(options)
  const response = await fetchJson<MarketSkillDetailResponse>(
    buildApiUrl(baseUrl, `/api/skills/${encodeURIComponent(slug)}`),
    options,
    '获取 Skill 详情失败',
  )
  return response.skill
}

async function downloadPackageToTemp(downloadUrl: string, slug: string, options: SkillMarketClientOptions): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(downloadUrl)
  if (!response.ok) {
    throw new Error(`下载 Skill 包失败: ${response.status}`)
  }

  const packagePath = join(tmpdir(), `foodism-skill-${basename(slug)}-${Date.now()}.skill`)
  const bytes = Buffer.from(await response.arrayBuffer())
  writeFileSync(packagePath, bytes)
  return packagePath
}

export async function installMarketSkillFromMarket(input: MarketSkillInstallInput, options: SkillMarketClientOptions = {}): Promise<SkillMeta> {
  const baseUrl = getSkillMarketBaseUrl(options)
  const detail = await getMarketSkill(input.slug, options)
  const download = await fetchJson<MarketSkillDownloadResponse>(
    buildApiUrl(baseUrl, `/api/skills/${encodeURIComponent(input.slug)}/download`),
    options,
    '获取 Skill 下载地址失败',
  )
  const packagePath = await downloadPackageToTemp(resolveDownloadUrl(baseUrl, download.downloadUrl), input.slug, options)

  try {
    return installMarketSkillPackageFromFile({
      workspaceSlug: input.workspaceSlug,
      packagePath,
      expectedSha256: download.packageSha256,
      marketSkill: {
        slug: detail.slug,
        name: detail.name,
        packageSha256: download.packageSha256,
        packageSizeBytes: download.packageSizeBytes,
      },
    })
  } finally {
    rmSync(packagePath, { force: true })
  }
}
