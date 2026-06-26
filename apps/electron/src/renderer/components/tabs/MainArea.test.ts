import { describe, expect, test } from 'bun:test'

describe('主区域业务页面渲染', () => {
  test('Given activeView is stale work-orders, When active tab is not work orders, Then MainArea does not render work orders view', async () => {
    const source = await Bun.file('apps/electron/src/renderer/components/tabs/MainArea.tsx').text()

    expect(source).toContain('shouldRenderWorkOrdersView')
    expect(source).toContain("activeView === 'work-orders' && activeTabId === WORK_ORDERS_TAB_ID")
    expect(source).toContain("shouldRenderWorkOrdersView ? (")
    expect(source).toContain('if (shouldRenderWorkOrdersView)')
  })
})
