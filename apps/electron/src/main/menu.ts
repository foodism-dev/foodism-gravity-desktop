import { Menu, shell, BrowserWindow, type BaseWindow } from 'electron'
import { dispatchBrowserTabCommandForWindow, type BrowserTabCommand } from './lib/browser-tab-view-manager'

const APP_DISPLAY_NAME = 'foodism-gravity'

function toBrowserWindow(win: BaseWindow | undefined): BrowserWindow | null {
  if (!win || win.isDestroyed()) return null
  if (win instanceof BrowserWindow) return win
  const focusedWindow = BrowserWindow.getFocusedWindow()
  return focusedWindow && !focusedWindow.isDestroyed() ? focusedWindow : null
}

function runBrowserTabCommandOrFallback(
  win: BaseWindow | undefined,
  command: BrowserTabCommand,
  fallback: (target: BrowserWindow) => void,
): void {
  const browserWindow = toBrowserWindow(win)
  if (!browserWindow) return
  if (dispatchBrowserTabCommandForWindow(browserWindow, command)) return
  fallback(browserWindow)
}

export function createApplicationMenu(): Menu {
  const isMac = process.platform === 'darwin'

  /**
   * 菜单快捷键说明：
   *
   * 大部分快捷键由渲染进程的 shortcut-registry 统一管理。
   * 但 Cmd+W 需要在菜单中拦截（否则 macOS 默认关闭窗口），
   * 改为通知渲染进程关闭当前标签页。
   */

  const template: Electron.MenuItemConstructorOptions[] = [
    // 应用菜单 (仅 macOS)
    ...(isMac
      ? [
          {
            label: APP_DISPLAY_NAME,
            submenu: [
              { role: 'about' as const, label: `关于 ${APP_DISPLAY_NAME}` },
              { type: 'separator' as const },
              { role: 'services' as const, label: '服务' },
              { type: 'separator' as const },
              { role: 'hide' as const, label: `隐藏 ${APP_DISPLAY_NAME}` },
              { role: 'hideOthers' as const, label: '隐藏其他' },
              { role: 'unhide' as const, label: '显示全部' },
              { type: 'separator' as const },
              { role: 'quit' as const, label: `退出 ${APP_DISPLAY_NAME}` },
            ],
          },
        ]
      : []),

    // 文件菜单
    {
      label: '文件',
      submenu: [
        // Cmd+W / Ctrl+W：关闭当前标签页（而非关闭窗口）
        {
          label: '关闭标签页',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const win = BrowserWindow.getFocusedWindow()
            if (win) {
              win.webContents.send('menu:close-tab')
            }
          },
        },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: '退出' }]),
      ],
    },

    // 编辑菜单
    {
      label: '编辑',
      submenu: [
        { role: 'undo' as const, label: '撤销' },
        { role: 'redo' as const, label: '重做' },
        { type: 'separator' as const },
        { role: 'cut' as const, label: '剪切' },
        { role: 'copy' as const, label: '复制' },
        { role: 'paste' as const, label: '粘贴' },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const, label: '粘贴并匹配样式' },
              { role: 'delete' as const, label: '删除' },
              { role: 'selectAll' as const, label: '全选' },
            ]
          : [{ role: 'delete' as const, label: '删除' }, { type: 'separator' as const }, { role: 'selectAll' as const, label: '全选' }]),
      ],
    },

    // 视图菜单
    {
      label: '视图',
      submenu: [
        {
          label: '重新加载',
          accelerator: 'CmdOrCtrl+R',
          click: (_, win) => runBrowserTabCommandOrFallback(win, 'reload', (target) => {
            target.webContents.reload()
          }),
        },
        {
          label: '强制重新加载',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: (_, win) => runBrowserTabCommandOrFallback(win, 'force-reload', (target) => {
            target.webContents.reloadIgnoringCache()
          }),
        },
        {
          label: '切换开发者工具',
          accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click: (_, win) => runBrowserTabCommandOrFallback(win, 'toggle-devtools', (target) => {
            target.webContents.toggleDevTools()
          }),
        },
        { type: 'separator' as const },
        {
          label: '重置缩放',
          accelerator: 'CmdOrCtrl+0',
          click: (_, win) => runBrowserTabCommandOrFallback(win, 'reset-zoom', (target) => {
            target.webContents.setZoomLevel(0)
          }),
        },
        {
          label: '放大',
          accelerator: 'CmdOrCtrl+Plus',
          click: (_, win) => runBrowserTabCommandOrFallback(win, 'zoom-in', (target) => {
            const currentZoomLevel = target.webContents.getZoomLevel()
            target.webContents.setZoomLevel(Math.min(currentZoomLevel + 0.5, 9))
          }),
        },
        {
          label: '缩小',
          accelerator: 'CmdOrCtrl+-',
          click: (_, win) => runBrowserTabCommandOrFallback(win, 'zoom-out', (target) => {
            const currentZoomLevel = target.webContents.getZoomLevel()
            target.webContents.setZoomLevel(Math.max(currentZoomLevel - 0.5, -8))
          }),
        },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const, label: '切换全屏' },
      ],
    },

    // 窗口菜单
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' as const, label: '最小化' },
        { role: 'zoom' as const, label: '缩放' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const, label: '前置全部窗口' },
              { type: 'separator' as const },
              { role: 'window' as const, label: '窗口' },
            ]
          : [{ role: 'close' as const, label: '关闭' }]),
      ],
    },

    // 帮助菜单
    {
      label: '帮助',
      role: 'help' as const,
      submenu: [
        {
          label: '了解更多',
          click: async () => {
            await shell.openExternal('https://github.com/yourusername/proma')
          },
        },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}
