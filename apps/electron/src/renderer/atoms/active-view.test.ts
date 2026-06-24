import { describe, expect, test } from 'bun:test'
import type { AgentSkillsCapabilityTab } from './active-view'

describe('Agent 技能子页', () => {
  test('Given 技能管理视图 When 枚举子页 Then 包含独立市场页', () => {
    const tabs: AgentSkillsCapabilityTab[] = ['skills', 'market', 'mcp']

    expect(tabs).toEqual(['skills', 'market', 'mcp'])
  })
})
