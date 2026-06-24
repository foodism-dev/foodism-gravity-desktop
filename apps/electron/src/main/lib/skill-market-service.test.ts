import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, test } from 'bun:test'
import AdmZip from 'adm-zip'
import { getWorkspaceSkillsDir } from './config-paths'
import {
  installMarketSkillFromMarket,
  hasMarketSkillUpdate,
  installMarketSkillPackageFromFile,
  listMarketSkills,
} from './skill-market-service'

const tempDirs: string[] = []

interface TestSkillPackage {
  packagePath: string
  sha256: string
  size: number
}

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function createSkillPackage(rootDir: string, slug: string, description = '测试 Skill'): TestSkillPackage {
  const packagePath = join(rootDir, `${slug}.skill`)
  const zip = new AdmZip()
  zip.addFile(`${slug}/SKILL.md`, Buffer.from(`---\nname: ${slug}\ndescription: ${description}\n---\n\n# ${slug}\n`, 'utf-8'))
  zip.addFile(`${slug}/references/example.md`, Buffer.from('example', 'utf-8'))
  zip.writeZip(packagePath)
  return {
    packagePath,
    sha256: sha256File(packagePath),
    size: statSync(packagePath).size,
  }
}

function crc32(buffer: Buffer): number {
  let crc = 0xFFFFFFFF
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function createStoredZip(entries: Array<{ name: string; content: string }>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf-8')
    const content = Buffer.from(entry.content, 'utf-8')
    const crc = crc32(content)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(content.length, 18)
    localHeader.writeUInt32LE(content.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localHeader.writeUInt16LE(0, 28)
    localParts.push(localHeader, name, content)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(content.length, 20)
    centralHeader.writeUInt32LE(content.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)

    offset += localHeader.length + name.length + content.length
  }

  const central = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, central, end])
}

function createUnsafePackage(rootDir: string): TestSkillPackage {
  const packagePath = join(rootDir, 'unsafe.skill')
  writeFileSync(packagePath, createStoredZip([
    { name: 'unsafe/SKILL.md', content: '---\nname: unsafe\ndescription: unsafe\n---\n' },
    { name: '../evil.txt', content: 'evil' },
  ]))
  return {
    packagePath,
    sha256: sha256File(packagePath),
    size: statSync(packagePath).size,
  }
}

afterEach(() => {
  delete process.env.FOODISM_GRAVITY_CONFIG_DIR
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Skill 市场本地安装', () => {
  test('Given 有效市场 Skill 包 When 安装到工作区 Then 写入 Skill 文件和 market 来源元数据', () => {
    const configDir = createTempDir('foodism-skill-market-config-')
    const packageDir = createTempDir('foodism-skill-market-package-')
    process.env.FOODISM_GRAVITY_CONFIG_DIR = configDir
    const pkg = createSkillPackage(packageDir, 'feedback-synthesis', '聚合反馈')

    const skill = installMarketSkillPackageFromFile({
      workspaceSlug: 'default',
      packagePath: pkg.packagePath,
      expectedSha256: pkg.sha256,
      marketSkill: {
        slug: 'feedback-synthesis',
        name: '用户反馈分析',
        packageSha256: pkg.sha256,
        packageSizeBytes: pkg.size,
      },
    })

    const skillDir = join(getWorkspaceSkillsDir('default'), 'feedback-synthesis')
    const source = JSON.parse(readFileSync(join(skillDir, '.source.json'), 'utf-8')) as Record<string, unknown>

    expect(skill.slug).toBe('feedback-synthesis')
    expect(skill.enabled).toBe(true)
    expect(skill.importSource).toEqual({
      kind: 'market',
      slug: 'feedback-synthesis',
      name: '用户反馈分析',
      packageSha256: pkg.sha256,
      packageSizeBytes: pkg.size,
      installedAt: expect.any(String),
    })
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
    expect(existsSync(join(skillDir, 'references/example.md'))).toBe(true)
    expect(source.kind).toBe('market')
    expect(source.packageSha256).toBe(pkg.sha256)
  })

  test('Given 包 sha256 与服务端元数据不一致 When 安装 Then 拒绝写入工作区', () => {
    const configDir = createTempDir('foodism-skill-market-config-')
    const packageDir = createTempDir('foodism-skill-market-package-')
    process.env.FOODISM_GRAVITY_CONFIG_DIR = configDir
    const pkg = createSkillPackage(packageDir, 'bad-hash')

    expect(() => installMarketSkillPackageFromFile({
      workspaceSlug: 'default',
      packagePath: pkg.packagePath,
      expectedSha256: 'wrong-sha',
      marketSkill: {
        slug: 'bad-hash',
        name: 'Bad Hash',
        packageSha256: 'wrong-sha',
        packageSizeBytes: pkg.size,
      },
    })).toThrow('Skill 包校验失败')

    expect(existsSync(join(getWorkspaceSkillsDir('default'), 'bad-hash'))).toBe(false)
  })

  test('Given 包含目录穿越路径的 Skill 包 When 安装 Then 拒绝解压', () => {
    const configDir = createTempDir('foodism-skill-market-config-')
    const packageDir = createTempDir('foodism-skill-market-package-')
    process.env.FOODISM_GRAVITY_CONFIG_DIR = configDir
    const pkg = createUnsafePackage(packageDir)

    expect(() => installMarketSkillPackageFromFile({
      workspaceSlug: 'default',
      packagePath: pkg.packagePath,
      expectedSha256: pkg.sha256,
      marketSkill: {
        slug: 'unsafe',
        name: 'Unsafe',
        packageSha256: pkg.sha256,
        packageSizeBytes: pkg.size,
      },
    })).toThrow('Skill 包路径不安全')

    expect(existsSync(join(configDir, 'agent-workspaces/default/evil.txt'))).toBe(false)
  })

  test('Given 已安装市场 Skill When 服务端 sha256 变化 Then 检测到可更新', () => {
    const configDir = createTempDir('foodism-skill-market-config-')
    const packageDir = createTempDir('foodism-skill-market-package-')
    process.env.FOODISM_GRAVITY_CONFIG_DIR = configDir
    const pkg = createSkillPackage(packageDir, 'sales-report')

    installMarketSkillPackageFromFile({
      workspaceSlug: 'default',
      packagePath: pkg.packagePath,
      expectedSha256: pkg.sha256,
      marketSkill: {
        slug: 'sales-report',
        name: '销售报告',
        packageSha256: pkg.sha256,
        packageSizeBytes: pkg.size,
      },
    })

    expect(hasMarketSkillUpdate('default', 'sales-report', pkg.sha256)).toBe(false)
    expect(hasMarketSkillUpdate('default', 'sales-report', 'new-sha')).toBe(true)
  })

  test('Given 查询条件 When 拉取市场 Skill 列表 Then 请求 server skills API 并返回列表', async () => {
    const requestedUrls: string[] = []
    const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
      requestedUrls.push(String(url))
      return Response.json({
        skills: [
          {
            slug: 'feedback-synthesis',
            name: '用户反馈分析',
            summary: '聚合反馈',
            icon: 'message-square',
            tags: ['research'],
            packageSha256: 'sha-list',
            packageSizeBytes: 100,
            downloadCount: 3,
            updatedAt: '2026-06-24T00:00:00.000Z',
          },
        ],
      })
    }

    const skills = await listMarketSkills(
      { query: '反馈', tag: 'research' },
      { baseUrl: 'https://api.example.com', fetchImpl },
    )

    expect(requestedUrls).toEqual(['https://api.example.com/api/skills?query=%E5%8F%8D%E9%A6%88&tag=research'])
    expect(skills[0]?.slug).toBe('feedback-synthesis')
    expect(Object.keys(skills[0]!)).not.toContain('version')
    expect(Object.keys(skills[0]!)).not.toContain('featured')
  })

  test('Given 市场 Skill slug When 从市场安装 Then 下载当前包并安装到目标工作区', async () => {
    const configDir = createTempDir('foodism-skill-market-config-')
    const packageDir = createTempDir('foodism-skill-market-package-')
    process.env.FOODISM_GRAVITY_CONFIG_DIR = configDir
    const pkg = createSkillPackage(packageDir, 'docx', '处理 Word 文档')
    const packageBytes = readFileSync(pkg.packagePath)
    const requestedUrls: string[] = []
    const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
      requestedUrls.push(String(url))
      if (String(url) === 'https://api.example.com/api/skills/docx') {
        return Response.json({
          skill: {
            slug: 'docx',
            name: 'Word 文档',
            summary: '处理 Word 文档',
            description: '创建、编辑和检查 docx 文件。',
            icon: 'file-text',
            tags: ['document'],
            packageSha256: pkg.sha256,
            packageSizeBytes: pkg.size,
            unpackedSizeBytes: 4096,
            fileCount: 2,
            manifest: {},
            downloadCount: 1,
            updatedAt: '2026-06-24T00:00:00.000Z',
          },
        })
      }
      if (String(url) === 'https://cdn.example.com/skills/docx.skill') {
        return new Response(packageBytes)
      }
      if (String(url) === 'https://api.example.com/api/skills/docx/download') {
        return Response.json({
          downloadUrl: 'https://cdn.example.com/skills/docx.skill',
          packageSha256: pkg.sha256,
          packageSizeBytes: pkg.size,
        })
      }
      return new Response('missing', { status: 404 })
    }

    const installed = await installMarketSkillFromMarket(
      { workspaceSlug: 'default', slug: 'docx' },
      { baseUrl: 'https://api.example.com', fetchImpl },
    )

    expect(requestedUrls).toEqual([
      'https://api.example.com/api/skills/docx',
      'https://api.example.com/api/skills/docx/download',
      'https://cdn.example.com/skills/docx.skill',
    ])
    expect(installed.slug).toBe('docx')
    expect(existsSync(join(getWorkspaceSkillsDir('default'), 'docx/SKILL.md'))).toBe(true)
  })
})
