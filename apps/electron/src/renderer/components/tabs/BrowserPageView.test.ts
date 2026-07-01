import { describe, expect, test } from 'bun:test'

describe('业务浏览器页面容器', () => {
  test('Given 我的工单 Web 入口 When 渲染 BrowserPageView Then 隐藏浏览器工具栏', async () => {
    const browserPageSource = await Bun.file('apps/electron/src/renderer/components/tabs/BrowserPageView.tsx').text()
    const workOrdersSource = await Bun.file('apps/electron/src/renderer/components/work-orders/WorkOrdersWebView.tsx').text()

    expect(browserPageSource).toContain('showToolbar = true')
    expect(workOrdersSource).toContain('showToolbar={false}')
  })

  test('Given RB 审核消息携带标题 When 宿主打开标签 Then 优先使用消息标题', async () => {
    const workOrdersSource = await Bun.file('apps/electron/src/renderer/components/work-orders/WorkOrdersWebView.tsx').text()

    expect(workOrdersSource).toContain('title?: string')
    expect(workOrdersSource).toContain("openSession(tab.type, tab.sessionId, message.title?.trim() || tab.title)")
  })

  test('Given 设置浮窗打开 When BrowserPageView 存在 Then 原生业务页面会临时隐藏', async () => {
    const browserPageSource = await Bun.file('apps/electron/src/renderer/components/tabs/BrowserPageView.tsx').text()

    expect(browserPageSource).toContain('settingsOpenAtom')
    expect(browserPageSource).toContain('settingsOpen')
    expect(browserPageSource).toContain('settingsOpen || nativeBrowserOverlayOpen')
    expect(browserPageSource).toContain('browserTabHide({ id })')
    expect(browserPageSource).toContain('browserTabShow({ id })')
  })

  test('Given renderer 浮层打开 When BrowserPageView 存在 Then 原生业务页面会临时隐藏', async () => {
    const browserPageSource = await Bun.file('apps/electron/src/renderer/components/tabs/BrowserPageView.tsx').text()
    const dropdownSource = await Bun.file('apps/electron/src/renderer/components/ui/dropdown-menu.tsx').text()
    const contextMenuSource = await Bun.file('apps/electron/src/renderer/components/ui/context-menu.tsx').text()
    const alertDialogSource = await Bun.file('apps/electron/src/renderer/components/ui/alert-dialog.tsx').text()
    const dialogSource = await Bun.file('apps/electron/src/renderer/components/ui/dialog.tsx').text()
    const sheetSource = await Bun.file('apps/electron/src/renderer/components/ui/sheet.tsx').text()

    expect(browserPageSource).toContain('useNativeBrowserOverlayOpen')
    expect(browserPageSource).toContain('nativeBrowserOverlayOpen')
    expect(browserPageSource).toContain('settingsOpen || nativeBrowserOverlayOpen')
    expect(dropdownSource).toContain('useNativeBrowserOverlayTracker')
    expect(contextMenuSource).toContain('useNativeBrowserOverlayTracker')
    expect(alertDialogSource).toContain('useNativeBrowserOverlayTracker')
    expect(dialogSource).toContain('useNativeBrowserOverlayTracker')
    expect(sheetSource).toContain('useNativeBrowserOverlayTracker')
  })

  test('Given 业务浏览器页可见 When 使用浏览器默认快捷键 Then 主进程优先派发给业务页面', async () => {
    const browserTabManagerSource = await Bun.file('apps/electron/src/main/lib/browser-tab-view-manager.ts').text()
    const menuSource = await Bun.file('apps/electron/src/main/menu.ts').text()

    expect(browserTabManagerSource).toContain('managed.view.webContents.focus()')
    expect(browserTabManagerSource).toContain('dispatchBrowserTabCommandForWindow')
    expect(browserTabManagerSource).toContain('reloadIgnoringCache')
    expect(menuSource).toContain('dispatchBrowserTabCommandForWindow(browserWindow,')
    expect(menuSource).toContain("accelerator: 'CmdOrCtrl+R'")
    expect(menuSource).toContain("accelerator: 'CmdOrCtrl+Shift+R'")
  })
})
