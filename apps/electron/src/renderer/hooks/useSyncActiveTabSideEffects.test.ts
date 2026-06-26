import { describe, expect, test } from 'bun:test'

describe('激活标签副作用同步', () => {
  test('Given work orders tab is closed, When syncing next active tab, Then main view returns to conversations', async () => {
    const source = await Bun.file('apps/electron/src/renderer/hooks/useSyncActiveTabSideEffects.ts').text()

    expect(source).toContain("import { activeViewAtom } from '@/atoms/active-view'")
    expect(source).toContain('const setActiveView = useSetAtom(activeViewAtom)')
    expect(source).toContain("setActiveView('conversations')")
  })
})
