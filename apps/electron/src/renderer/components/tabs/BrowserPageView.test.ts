import { describe, expect, test } from 'bun:test'

describe('业务浏览器页面容器', () => {
  test('Given 我的工单 Web 入口 When 渲染 BrowserPageView Then 隐藏浏览器工具栏', async () => {
    const browserPageSource = await Bun.file('apps/electron/src/renderer/components/tabs/BrowserPageView.tsx').text()
    const workOrdersSource = await Bun.file('apps/electron/src/renderer/components/work-orders/WorkOrdersWebView.tsx').text()

    expect(browserPageSource).toContain('showToolbar = true')
    expect(workOrdersSource).toContain('showToolbar={false}')
  })

  test('Given 设置浮窗打开 When BrowserPageView 存在 Then 原生业务页面会临时隐藏', async () => {
    const browserPageSource = await Bun.file('apps/electron/src/renderer/components/tabs/BrowserPageView.tsx').text()

    expect(browserPageSource).toContain('settingsOpenAtom')
    expect(browserPageSource).toContain('settingsOpen')
    expect(browserPageSource).toContain('if (settingsOpen) return')
    expect(browserPageSource).toContain('browserTabHide({ id })')
    expect(browserPageSource).toContain('browserTabShow({ id })')
  })
})
