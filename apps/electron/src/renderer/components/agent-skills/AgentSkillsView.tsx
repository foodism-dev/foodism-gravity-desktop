/**
 * AgentSkillsView — 「Agent 技能」全屏视图
 *
 * 由侧边栏「Agent 技能」入口触发，全屏占据中间内容区（隐藏 TabBar 与右侧文件面板）。
 *
 * 结构：
 * - 顶部：标题 + 工作区切换下拉
 * - 工具条：Skills / MCP 切换 + 搜索 + Skill 市场 + 新增入口
 * - 内容：能力卡片网格（商店风），点击卡片打开右侧详情抽屉
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Blocks, ChevronDown, Search, Plus, FolderOpen, Check, Download, RefreshCw, PackageCheck, ShieldCheck, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { workspaceCapabilitiesVersionAtom } from '@/atoms/agent-atoms'
import { agentSkillsTabAtom } from '@/atoms/active-view'
import { settingsOpenAtom, settingsTabAtom, toolSettingsFocusAtom, type ToolSettingsFocus } from '@/atoms/settings-tab'
import { useProjectActions } from '@/hooks/useProjectActions'
import type { BuiltinMcpServerSummary, MarketSkillDetail, MarketSkillSummary, McpServerEntry, SkillMeta } from '@proma/shared'
import { useAgentSkillsData } from './useAgentSkillsData'
import { SkillCard } from './SkillCard'
import { McpCard } from './McpCard'
import { SkillDetailSheet } from './SkillDetailSheet'
import { McpDetailSheet } from './McpDetailSheet'
import { BuiltinMcpDetailSheet } from './BuiltinMcpDetailSheet'
import { ImportSkillDialog } from './ImportSkillDialog'
import foodismLogo from '@/assets/models/foodism.png'

export function AgentSkillsView(): React.ReactElement {
  const data = useAgentSkillsData()
  const bumpCapabilities = useSetAtom(workspaceCapabilitiesVersionAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const setToolSettingsFocus = useSetAtom(toolSettingsFocusAtom)
  const { workspaces, currentWorkspaceId, selectProject } = useProjectActions()

  const [tab, setTab] = useAtom(agentSkillsTabAtom)
  const [search, setSearch] = React.useState('')
  const [selectedSkillSlug, setSelectedSkillSlug] = React.useState<string | null>(null)
  const [mcpSheetOpen, setMcpSheetOpen] = React.useState(false)
  const [editingMcp, setEditingMcp] = React.useState<{ name: string; entry: McpServerEntry } | null>(null)
  const [selectedBuiltinMcp, setSelectedBuiltinMcp] = React.useState<BuiltinMcpServerSummary | null>(null)
  const [showImport, setShowImport] = React.useState(false)
  const [marketLoading, setMarketLoading] = React.useState(false)
  const [marketSkills, setMarketSkills] = React.useState<MarketSkillSummary[]>([])
  const [selectedMarketSkillSlug, setSelectedMarketSkillSlug] = React.useState<string | null>(null)
  const [selectedMarketSkill, setSelectedMarketSkill] = React.useState<MarketSkillDetail | null>(null)
  const [marketDetailLoading, setMarketDetailLoading] = React.useState(false)
  const [installingMarketSlug, setInstallingMarketSlug] = React.useState<string | null>(null)
  const [wsPopoverOpen, setWsPopoverOpen] = React.useState(false)
  const [pendingDeleteSkill, setPendingDeleteSkill] = React.useState<SkillMeta | null>(null)
  const [pendingDeleteMcpName, setPendingDeleteMcpName] = React.useState<string | null>(null)
  const [isDeletingSkill, setIsDeletingSkill] = React.useState(false)
  const [isDeletingMcp, setIsDeletingMcp] = React.useState(false)

  const q = search.trim().toLowerCase()

  const filteredSkills = React.useMemo(() => {
    if (!q) return data.skills
    return data.skills.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.slug.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q),
    )
  }, [data.skills, q])

  const customSkills = filteredSkills.filter((s) => !data.defaultSkillSlugs.has(s.slug))
  const builtinSkills = filteredSkills.filter((s) => data.defaultSkillSlugs.has(s.slug))
  const updateCount = data.skills.filter((s) => s.hasUpdate).length
  const installedSkillMap = React.useMemo(() => new Map(data.skills.map((skill) => [skill.slug, skill])), [data.skills])

  const userMcpEntries = React.useMemo(() => {
    return Object.entries(data.mcpConfig.servers ?? {})
      .filter(([name]) => name !== 'memos-cloud')
      .filter(([name]) => !q || name.toLowerCase().includes(q))
  }, [data.mcpConfig, q])

  const builtinMcpServers = React.useMemo(() => {
    if (!q) return data.builtinMcpServers
    return data.builtinMcpServers.filter((server) =>
      server.name.toLowerCase().includes(q) ||
      server.displayName.toLowerCase().includes(q) ||
      server.description.toLowerCase().includes(q) ||
      server.tools.some((tool) => tool.name.toLowerCase().includes(q) || tool.description.toLowerCase().includes(q)),
    )
  }, [data.builtinMcpServers, q])

  // 不含搜索过滤的 MCP 总数（标签计数与空态判断用）
  const mcpCount = React.useMemo(
    () => Object.keys(data.mcpConfig.servers ?? {}).filter((n) => n !== 'memos-cloud').length + data.builtinMcpServers.length,
    [data.mcpConfig, data.builtinMcpServers],
  )

  const selectedSkill = data.skills.find((s) => s.slug === selectedSkillSlug) ?? null
  const selectedIsBuiltin = selectedSkill ? data.defaultSkillSlugs.has(selectedSkill.slug) : false

  const openSkillFolder = (slug: string): void => {
    if (data.skillsDir) window.electronAPI.openFile(`${data.skillsDir}/${slug}`)
  }

  const loadMarketSkills = React.useCallback(async (): Promise<void> => {
    setMarketLoading(true)
    try {
      const skills = await window.electronAPI.listMarketSkills({ query: search.trim() || undefined })
      setMarketSkills(skills)
    } catch (error) {
      console.error('[Skill 市场] 加载失败:', error)
      toast.error('加载 Skill 市场失败')
    } finally {
      setMarketLoading(false)
    }
  }, [search])

  React.useEffect(() => {
    if (tab !== 'market') return
    void loadMarketSkills()
  }, [tab, loadMarketSkills])

  React.useEffect(() => {
    if (!selectedMarketSkillSlug) {
      setSelectedMarketSkill(null)
      return
    }

    setMarketDetailLoading(true)
    window.electronAPI.getMarketSkill(selectedMarketSkillSlug)
      .then(setSelectedMarketSkill)
      .catch((error) => {
        console.error('[Skill 市场] 加载详情失败:', error)
        toast.error('加载 Skill 详情失败')
        setSelectedMarketSkillSlug(null)
      })
      .finally(() => setMarketDetailLoading(false))
  }, [selectedMarketSkillSlug])

  const installMarketSkill = React.useCallback(async (skill: MarketSkillSummary): Promise<void> => {
    if (!data.workspaceSlug || installingMarketSlug) return
    setInstallingMarketSlug(skill.slug)
    try {
      const installed = await window.electronAPI.installMarketSkill({
        workspaceSlug: data.workspaceSlug,
        slug: skill.slug,
      })
      toast.success(`已安装 Skill：${installed.name}`)
      bumpCapabilities((v) => v + 1)
      void loadMarketSkills()
    } catch (error) {
      console.error('[Skill 市场] 安装失败:', error)
      const message = error instanceof Error ? error.message : '未知错误'
      toast.error('安装 Skill 失败', { description: message })
    } finally {
      setInstallingMarketSlug(null)
    }
  }, [data.workspaceSlug, installingMarketSlug, bumpCapabilities, loadMarketSkills])

  const configureBuiltinMcp = React.useCallback((serverId: string): void => {
    const focusMap: Partial<Record<string, ToolSettingsFocus>> = {
      mem: 'memory',
      'nano-banana': 'nano-banana',
    }
    const focus = focusMap[serverId]
    if (!focus) return
    setToolSettingsFocus(focus)
    setSettingsTab('tools')
    setSettingsOpen(true)
    setSelectedBuiltinMcp(null)
  }, [setSettingsOpen, setSettingsTab, setToolSettingsFocus])

  if (!data.hasWorkspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]">
          <Blocks className="size-8 text-foreground/30" />
        </div>
        <div className="text-[15px] font-medium text-foreground/80">未选择工作区</div>
        <div className="max-w-sm text-[13px] text-foreground/50">
          请先选择或创建一个工作区，再来管理它的 Skills 与 MCP。
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 标题栏 + 工作区切换 */}
      {/* 不加 titlebar-drag-region：与 DropdownMenu 嵌套时 drag/no-drag 会让 Radix 拿不到
          pointerdown，下拉打不开。窗口拖拽由 AppShell 顶部 0–50px 的全局 drag 层兜底。
          pt-14 让按钮整体位于全局 drag 层（0–50px, z-50）下方，避免被吃掉点击。 */}
      <div className="titlebar-no-drag mx-auto flex w-full max-w-6xl shrink-0 items-center justify-between px-8 pt-14 pb-4">
        <div className="flex items-center gap-2.5">
          <Blocks className="size-6 text-foreground/70" />
          <h1 className="text-2xl font-semibold text-foreground">技能</h1>
        </div>

        <Popover open={wsPopoverOpen} onOpenChange={setWsPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="titlebar-no-drag flex items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 py-1.5 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.04]"
            >
              <FolderOpen size={14} className="text-foreground/45" />
              <span className="max-w-[180px] truncate">{data.workspaceName}</span>
              <ChevronDown size={14} className="text-foreground/45" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-[320px] w-56 overflow-y-auto scrollbar-thin p-1">
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  if (w.id !== currentWorkspaceId) {
                    selectProject(w.id, { resetView: false })
                    toast.success(`已切换到工作区「${w.name}」`)
                  }
                  setWsPopoverOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors',
                  w.id === currentWorkspaceId
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground/80 hover:bg-accent/50',
                )}
              >
                <span className="truncate">{w.name}</span>
                {w.id === currentWorkspaceId && <Check size={14} className="shrink-0 text-primary" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      {/* 工具条 */}
      <div className="titlebar-no-drag mx-auto flex w-full max-w-6xl shrink-0 items-center gap-3 px-8 pb-4">
        {/* 本地 / 市场 / MCP 切换 */}
        <div className="grid h-8 grid-cols-3 items-stretch rounded-xl bg-muted p-0.5">
          {([
            { value: 'skills' as const, label: '本地', count: data.skills.length },
            { value: 'market' as const, label: '市场', count: marketSkills.length },
            { value: 'mcp' as const, label: 'MCP', count: mcpCount },
          ]).map(({ value, label, count }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                'flex min-w-[92px] items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition-colors duration-200',
                tab === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
              {value !== 'market' || count > 0 ? (
                <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* 搜索框 */}
        <div className="flex h-8 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 transition-colors focus-within:border-primary/40">
          <Search size={14} className="shrink-0 text-foreground/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'skills' ? '搜索本地 Skills...' : tab === 'market' ? '搜索市场 Skills...' : '搜索 MCP 服务器...'}
            className="w-full bg-transparent text-[13px] text-foreground placeholder:text-foreground/35 focus:outline-none"
          />
        </div>

        {tab === 'market' && (
          <button
            type="button"
            onClick={() => { void loadMarketSkills() }}
            disabled={marketLoading}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-content-area px-3 text-[13px] font-medium text-foreground/80 shadow-sm transition-colors hover:bg-foreground/[0.04] disabled:opacity-60"
          >
            <RefreshCw size={14} className={cn(marketLoading && 'animate-spin')} />
            <span>刷新</span>
          </button>
        )}

        {/* Skills：从其他工作区导入 */}
        {tab === 'skills' && (
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-content-area px-3 text-[13px] font-medium text-foreground/80 shadow-sm transition-colors hover:bg-foreground/[0.04]"
          >
            <Plus size={14} />
            <span>导入</span>
          </button>
        )}

        {/* 新增 MCP */}
        {tab === 'mcp' && (
          <button
            type="button"
            onClick={() => { setEditingMcp(null); setMcpSheetOpen(true) }}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus size={14} />
            <span>添加服务器</span>
          </button>
        )}
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto w-full max-w-6xl px-8 pb-10">
          {data.loading ? (
            <div className="py-20 text-center text-sm text-muted-foreground">加载中...</div>
          ) : tab === 'skills' ? (
            <SkillsTab
              customSkills={customSkills}
              builtinSkills={builtinSkills}
              total={data.skills.length}
              updateCount={updateCount}
              updatingSkill={data.updatingSkill}
              isBuiltin={(slug) => data.defaultSkillSlugs.has(slug)}
              onOpen={setSelectedSkillSlug}
              onToggle={data.toggleSkill}
              onUpdate={data.updateSkill}
            />
          ) : tab === 'market' ? (
            <MarketTab
              skills={marketSkills}
              loading={marketLoading}
              installedSkillMap={installedSkillMap}
              installingSlug={installingMarketSlug}
              onOpen={setSelectedMarketSkillSlug}
              onInstall={installMarketSkill}
              onRefresh={loadMarketSkills}
            />
          ) : (
            <McpTab
              userEntries={userMcpEntries}
              builtinServers={builtinMcpServers}
              total={mcpCount}
              onOpen={(name, entry) => { setEditingMcp({ name, entry }); setMcpSheetOpen(true) }}
              onOpenBuiltin={setSelectedBuiltinMcp}
              onToggle={data.toggleMcp}
              onToggleBuiltin={data.toggleBuiltinMcp}
              onRequestDelete={setPendingDeleteMcpName}
              onAdd={() => { setEditingMcp(null); setMcpSheetOpen(true) }}
            />
          )}
        </div>
      </div>

      {/* 详情抽屉 */}
      <SkillDetailSheet
        skill={selectedSkill}
        workspaceSlug={data.workspaceSlug}
        isBuiltin={selectedIsBuiltin}
        updating={data.updatingSkill === selectedSkill?.slug}
        onOpenChange={(open) => { if (!open) setSelectedSkillSlug(null) }}
        onToggle={(enabled) => selectedSkill && data.toggleSkill(selectedSkill.slug, enabled)}
        onUpdate={() => selectedSkill && data.updateSkill(selectedSkill.slug)}
        onRequestDelete={() => selectedSkill && setPendingDeleteSkill(selectedSkill)}
        onOpenFolder={() => selectedSkill && openSkillFolder(selectedSkill.slug)}
        onChanged={() => bumpCapabilities((v) => v + 1)}
      />

      <MarketSkillDetailSheet
        skill={selectedMarketSkill}
        loading={marketDetailLoading}
        installState={selectedMarketSkill ? getMarketInstallState(selectedMarketSkill, installedSkillMap.get(selectedMarketSkill.slug)) : 'install'}
        installing={selectedMarketSkill ? installingMarketSlug === selectedMarketSkill.slug : false}
        onOpenChange={(open) => { if (!open) setSelectedMarketSkillSlug(null) }}
        onInstall={(skill) => { void installMarketSkill(skill) }}
      />

      {/* Skill 删除确认 */}
      <ConfirmDialog
        open={pendingDeleteSkill !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteSkill(null) }}
        title={`确认删除 Skill「${pendingDeleteSkill?.name}」？`}
        description="删除后将无法恢复，确定要卸载这个 Skill 吗？"
        confirmLabel="删除"
        loadingLabel="删除中..."
        loading={isDeletingSkill}
        onConfirm={async () => {
          if (!pendingDeleteSkill || isDeletingSkill) return
          setIsDeletingSkill(true)
          const ok = await data.deleteSkill(pendingDeleteSkill.slug, pendingDeleteSkill.name)
          setIsDeletingSkill(false)
          setPendingDeleteSkill(null)
          if (ok) setSelectedSkillSlug(null)
        }}
      />

      {/* MCP 删除确认 */}
      <ConfirmDialog
        open={pendingDeleteMcpName !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteMcpName(null) }}
        title={`确认删除 MCP 服务器「${pendingDeleteMcpName}」？`}
        description="删除后将无法恢复，确定要删除这个 MCP 服务器吗？"
        confirmLabel="删除"
        loadingLabel="删除中..."
        loading={isDeletingMcp}
        onConfirm={async () => {
          if (!pendingDeleteMcpName || isDeletingMcp) return
          setIsDeletingMcp(true)
          await data.deleteMcp(pendingDeleteMcpName)
          setIsDeletingMcp(false)
          setPendingDeleteMcpName(null)
        }}
      />

      <McpDetailSheet
        open={mcpSheetOpen}
        server={editingMcp}
        workspaceSlug={data.workspaceSlug}
        onOpenChange={(open) => { setMcpSheetOpen(open); if (!open) bumpCapabilities((v) => v + 1) }}
        onSaved={() => setMcpSheetOpen(false)}
        onChanged={() => bumpCapabilities((v) => v + 1)}
      />

      <BuiltinMcpDetailSheet
        open={!!selectedBuiltinMcp}
        server={selectedBuiltinMcp}
        onOpenChange={(open) => { if (!open) setSelectedBuiltinMcp(null) }}
        onConfigure={configureBuiltinMcp}
      />

      <ImportSkillDialog
        open={showImport}
        onOpenChange={setShowImport}
        workspaceSlug={data.workspaceSlug}
        installedSkills={data.skills}
        onImported={() => bumpCapabilities((v) => v + 1)}
      />
    </div>
  )
}

// ===== Market Tab =====

interface MarketTabProps {
  skills: MarketSkillSummary[]
  loading: boolean
  installedSkillMap: Map<string, SkillMeta>
  installingSlug: string | null
  onOpen: (slug: string) => void
  onInstall: (skill: MarketSkillSummary) => Promise<void>
  onRefresh: () => Promise<void>
}

type MarketInstallState = 'install' | 'installed' | 'update'

function getMarketInstallState(skill: MarketSkillSummary, localSkill: SkillMeta | undefined): MarketInstallState {
  if (!localSkill) return 'install'
  if (localSkill.importSource?.kind !== 'market') return 'install'
  return localSkill.importSource.packageSha256 === skill.packageSha256 ? 'installed' : 'update'
}

function formatBytes(value: number | null | undefined): string {
  if (!value) return '未知'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function MarketTab({ skills, loading, installedSkillMap, installingSlug, onOpen, onInstall, onRefresh }: MarketTabProps): React.ReactElement {
  const installedCount = skills.filter((skill) => getMarketInstallState(skill, installedSkillMap.get(skill.slug)) === 'installed').length

  if (loading && skills.length === 0) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
        <RefreshCw className="mr-2 size-4 animate-spin" />
        正在加载 Skill 市场...
      </div>
    )
  }

  if (skills.length === 0) {
    return (
      <EmptyState
        icon={<img src={foodismLogo} alt="万店引力" className="size-9 object-contain opacity-70" />}
        title="市场暂无匹配 Skill"
        hint="换一个关键词，或确认本地 server 已经连接到 Skill 市场数据库。"
        action={
          <button
            type="button"
            onClick={() => { void onRefresh() }}
            className="mt-2 flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <RefreshCw size={14} />
            <span>重新加载</span>
          </button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/50 pb-4">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-medium text-primary">
            <img src={foodismLogo} alt="万店引力" className="size-4 object-contain" />
            万店引力 Skill 市场
          </div>
          <h2 className="mt-1 text-xl font-semibold text-foreground">安装官方维护的能力包</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            从万店引力维护的能力库中选择适合当前工作区的 Skill，安装后即可在 Agent 对话中使用。
          </p>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className="rounded-md bg-muted px-2 py-1">共 {skills.length} 个</span>
          <span className="rounded-md bg-muted px-2 py-1">已装 {installedCount} 个</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {skills.map((skill) => {
          const installState = getMarketInstallState(skill, installedSkillMap.get(skill.slug))
          const installed = installState === 'installed'
          const canInstall = installState !== 'installed'
          const installing = installingSlug === skill.slug
          return (
            <button
              key={skill.slug}
              type="button"
              onClick={() => onOpen(skill.slug)}
              className="group flex min-h-[188px] flex-col rounded-lg bg-content-area p-4 text-left shadow-sm ring-1 ring-border/45 transition-all hover:-translate-y-0.5 hover:shadow-md hover:ring-primary/25"
            >
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <PackageCheck size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[15px] font-semibold text-foreground">{skill.name}</h3>
                    {installed && (
                      <span className="shrink-0 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        已安装
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{skill.slug}</div>
                </div>
              </div>

              <p className="mt-3 line-clamp-3 min-h-[54px] text-[13px] leading-relaxed text-muted-foreground">
                {skill.summary ?? '这个 Skill 还没有简介。'}
              </p>

              <div className="mt-3 flex min-h-[22px] flex-wrap gap-1.5">
                {skill.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span>{formatBytes(skill.packageSizeBytes)}</span>
                  <span>{skill.downloadCount} 次安装</span>
                  <span>{formatDate(skill.updatedAt)}</span>
                </div>
                <button
                  type="button"
                  disabled={installing || !canInstall}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (canInstall) void onInstall(skill)
                  }}
                  className={cn(
                    'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors',
                    !canInstall
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90',
                    (installing || !canInstall) && 'opacity-60',
                  )}
                >
                  {installing ? <RefreshCw size={13} className="animate-spin" /> : installed ? <Check size={13} /> : <Download size={13} />}
                  <span>{installing ? '安装中' : installed ? '已安装' : installState === 'update' ? '更新' : '安装'}</span>
                </button>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface MarketSkillDetailSheetProps {
  skill: MarketSkillDetail | null
  loading: boolean
  installState: MarketInstallState
  installing: boolean
  onOpenChange: (open: boolean) => void
  onInstall: (skill: MarketSkillDetail) => void
}

function MarketSkillDetailSheet({ skill, loading, installState, installing, onOpenChange, onInstall }: MarketSkillDetailSheetProps): React.ReactElement {
  const open = loading || !!skill
  const installed = installState === 'installed'
  const canInstall = installState !== 'installed'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent hideClose side="right" className="flex w-[520px] flex-col gap-0 p-0 sm:max-w-[520px]" aria-describedby={undefined}>
        <SheetTitle className="sr-only">市场 Skill 详情</SheetTitle>
        {loading && !skill ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <RefreshCw className="mr-2 size-4 animate-spin" />
            加载详情中...
          </div>
        ) : skill ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 border-b border-border/60 px-5 pb-4 pt-5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <div className="text-lg font-semibold text-foreground">{skill.name}</div>
                  <div className="text-xs text-muted-foreground">{skill.slug}</div>
                </div>
              </div>

              <button
                type="button"
                disabled={installing || !canInstall}
                onClick={() => { if (canInstall) onInstall(skill) }}
                className={cn(
                  'mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-md text-[13px] font-medium transition-colors',
                  installed
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90',
                  (installing || !canInstall) && 'opacity-60',
                )}
              >
                {installing ? <RefreshCw size={14} className="animate-spin" /> : installed ? <Check size={14} /> : <Download size={14} />}
                <span>{installing ? '安装中' : installed ? '已安装当前包' : installState === 'update' ? '更新到当前包' : '安装到当前工作区'}</span>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-5">
              <div className="space-y-5">
                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">简介</div>
                  <p className="mt-2 text-[13px] leading-relaxed text-foreground/80">
                    {skill.description ?? skill.summary ?? '这个 Skill 还没有详情说明。'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <MarketMeta label="包大小" value={formatBytes(skill.packageSizeBytes)} />
                  <MarketMeta label="解压大小" value={formatBytes(skill.unpackedSizeBytes)} />
                  <MarketMeta label="文件数" value={skill.fileCount == null ? '未知' : String(skill.fileCount)} />
                  <MarketMeta label="安装次数" value={String(skill.downloadCount)} />
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">标签</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {skill.tags.length > 0 ? skill.tags.map((tag) => (
                      <span key={tag} className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">{tag}</span>
                    )) : (
                      <span className="text-[12px] text-muted-foreground">暂无标签</span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
                    <ShieldCheck size={13} />
                    包校验
                  </div>
                  <div className="mt-2 break-all rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {skill.packageSha256}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Manifest</div>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
                    {JSON.stringify(skill.manifest, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function MarketMeta({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="rounded-lg bg-muted p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-[13px] font-medium text-foreground">{value}</div>
    </div>
  )
}

// ===== Skills Tab =====

interface SkillsTabProps {
  customSkills: SkillMeta[]
  builtinSkills: SkillMeta[]
  total: number
  updateCount: number
  updatingSkill: string | null
  isBuiltin: (slug: string) => boolean
  onOpen: (slug: string) => void
  onToggle: (slug: string, enabled: boolean) => void
  onUpdate: (slug: string) => void
}

function SkillsTab({ customSkills, builtinSkills, total, updateCount, updatingSkill, isBuiltin, onOpen, onToggle, onUpdate }: SkillsTabProps): React.ReactElement {
  if (total === 0) {
    return <EmptyState icon={<Blocks className="size-8 text-foreground/30" />} title="暂无 Skill" hint="可以让 Foodism 帮你联网查找并安装 Skill，或从其他工作区导入。" />
  }
  if (customSkills.length === 0 && builtinSkills.length === 0) {
    return <EmptyState icon={<Search className="size-8 text-foreground/30" />} title="没有匹配的 Skill" hint="试试更换搜索关键词。" />
  }

  return (
    <div className="flex flex-col gap-8">
      {updateCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/[0.06] px-3 py-2 text-[13px] text-blue-600 dark:text-blue-400">
          有 {updateCount} 个 Skill 可更新到来源最新版本
        </div>
      )}
      {customSkills.length > 0 && (
        <SkillSection title="我的 Skills" skills={customSkills} isBuiltin={isBuiltin} updatingSkill={updatingSkill} onOpen={onOpen} onToggle={onToggle} onUpdate={onUpdate} />
      )}
      {builtinSkills.length > 0 && (
        <SkillSection title="内置" skills={builtinSkills} isBuiltin={isBuiltin} updatingSkill={updatingSkill} onOpen={onOpen} onToggle={onToggle} onUpdate={onUpdate} />
      )}
    </div>
  )
}

interface SkillSectionProps {
  title: string
  skills: SkillMeta[]
  isBuiltin: (slug: string) => boolean
  updatingSkill: string | null
  onOpen: (slug: string) => void
  onToggle: (slug: string, enabled: boolean) => void
  onUpdate: (slug: string) => void
}

function SkillSection({ title, skills, isBuiltin, updatingSkill, onOpen, onToggle, onUpdate }: SkillSectionProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[13px] font-medium text-foreground/55">{title}</span>
        <span className="text-[12px] tabular-nums text-foreground/35">{skills.length}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {skills.map((skill) => (
          <SkillCard
            key={skill.slug}
            skill={skill}
            isBuiltin={isBuiltin(skill.slug)}
            updating={updatingSkill === skill.slug}
            onOpen={() => onOpen(skill.slug)}
            onToggle={(enabled) => onToggle(skill.slug, enabled)}
            onUpdate={() => onUpdate(skill.slug)}
          />
        ))}
      </div>
    </div>
  )
}

// ===== MCP Tab =====

interface McpTabProps {
  userEntries: Array<[string, McpServerEntry]>
  builtinServers: BuiltinMcpServerSummary[]
  total: number
  onOpen: (name: string, entry: McpServerEntry) => void
  onOpenBuiltin: (server: BuiltinMcpServerSummary) => void
  onToggle: (name: string, enabled: boolean) => void
  onToggleBuiltin: (id: string, enabled: boolean) => void
  onRequestDelete: (name: string) => void
  onAdd: () => void
}

function McpTab({ userEntries, builtinServers, total, onOpen, onOpenBuiltin, onToggle, onToggleBuiltin, onRequestDelete, onAdd }: McpTabProps): React.ReactElement {
  if (total === 0) {
    return (
      <EmptyState
        icon={<Plus className="size-8 text-foreground/30" />}
        title="还没有 MCP 服务器"
        hint="点击右上角「添加服务器」开始，或让 Foodism 帮你查找并配置。"
        action={
          <button
            type="button"
            onClick={onAdd}
            className="mt-2 flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus size={14} />
            <span>添加服务器</span>
          </button>
        }
      />
    )
  }
  if (userEntries.length === 0 && builtinServers.length === 0) {
    return <EmptyState icon={<Search className="size-8 text-foreground/30" />} title="没有匹配的 MCP 服务器" hint="试试更换搜索关键词。" />
  }

  return (
    <div className="flex flex-col gap-8">
      {userEntries.length > 0 && (
        <McpSection title="我的 MCP" count={userEntries.length}>
          {userEntries.map(([name, entry]) => (
            <McpCard
              key={name}
              name={name}
              entry={entry}
              onOpen={() => onOpen(name, entry)}
              onToggle={(enabled) => onToggle(name, enabled)}
              onRequestDelete={() => onRequestDelete(name)}
            />
          ))}
        </McpSection>
      )}

      {builtinServers.length > 0 && (
        <McpSection title="Proma 内置" count={builtinServers.length}>
          {builtinServers.map((server) => (
            <McpCard
              key={server.id}
              name={server.displayName}
              entry={{
                type: 'stdio',
                command: 'Proma 运行时注入',
                enabled: server.enabled,
                isBuiltin: true,
              }}
              description={server.description}
              targetLabel={server.availabilityReason ?? 'Proma 运行时注入'}
              statusLabel={getBuiltinMcpStatus(server).label}
              statusTone={getBuiltinMcpStatus(server).tone}
              readOnly
              onOpen={() => onOpenBuiltin(server)}
              onToggle={(enabled) => onToggleBuiltin(server.id, enabled)}
            />
          ))}
        </McpSection>
      )}
    </div>
  )
}

function getBuiltinMcpStatus(server: BuiltinMcpServerSummary): { label: string; tone: 'success' | 'warning' | 'muted' } {
  if (!server.enabled) return { label: '已关闭', tone: 'muted' }
  if (server.available) return { label: '可用', tone: 'success' }
  return { label: '需配置', tone: 'warning' }
}

function McpSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[13px] font-medium text-foreground/55">{title}</span>
        <span className="text-[12px] tabular-nums text-foreground/35">{count}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </div>
  )
}

// ===== Empty State =====

function EmptyState({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint: string; action?: React.ReactNode }): React.ReactElement {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-24 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]">{icon}</div>
      <div className="flex flex-col gap-1.5">
        <div className="text-[15px] font-medium text-foreground/85">{title}</div>
        <div className="text-[13px] leading-relaxed text-foreground/50">{hint}</div>
      </div>
      {action}
    </div>
  )
}
