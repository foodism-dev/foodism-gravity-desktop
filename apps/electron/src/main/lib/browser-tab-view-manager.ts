/**
 * 原生业务浏览器 Tab 管理器。
 *
 * 使用 WebContentsView 承载工单/RB 等业务页面，renderer 只负责同步占位区域。
 */

import { BrowserWindow, WebContentsView, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type Rectangle } from 'electron'
import { join } from 'node:path'

interface BrowserTabBounds extends Rectangle {}

interface BrowserTabEnsureInput {
  id: string
  url: string
  bounds: BrowserTabBounds
}

interface BrowserTabBoundsInput {
  id: string
  bounds: BrowserTabBounds
}

interface BrowserTabIdInput {
  id: string
}

interface BrowserTabHostMessagePayload {
  tabId: string
  message: unknown
}

interface ManagedBrowserTabView {
  id: string
  url: string
  ownerWindow: BrowserWindow
  view: WebContentsView
  visible: boolean
}

const managedViews = new Map<string, ManagedBrowserTabView>()
const webContentsToTabId = new Map<number, string>()
let ipcRegistered = false

export type BrowserTabCommand =
  | 'reload'
  | 'force-reload'
  | 'toggle-devtools'
  | 'reset-zoom'
  | 'zoom-in'
  | 'zoom-out'

function isValidBrowserTabUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeBounds(bounds: BrowserTabBounds): BrowserTabBounds {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  }
}

function isEnsureInput(value: unknown): value is BrowserTabEnsureInput {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Partial<BrowserTabEnsureInput>
  return typeof input.id === 'string'
    && input.id.trim().length > 0
    && typeof input.url === 'string'
    && isValidBrowserTabUrl(input.url)
    && isBounds(input.bounds)
}

function isBoundsInput(value: unknown): value is BrowserTabBoundsInput {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Partial<BrowserTabBoundsInput>
  return typeof input.id === 'string' && input.id.trim().length > 0 && isBounds(input.bounds)
}

function isIdInput(value: unknown): value is BrowserTabIdInput {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Partial<BrowserTabIdInput>
  return typeof input.id === 'string' && input.id.trim().length > 0
}

function isBounds(value: unknown): value is BrowserTabBounds {
  if (typeof value !== 'object' || value === null) return false
  const bounds = value as Partial<BrowserTabBounds>
  return typeof bounds.x === 'number'
    && typeof bounds.y === 'number'
    && typeof bounds.width === 'number'
    && typeof bounds.height === 'number'
}

function getPreloadPath(): string {
  return join(__dirname, 'browser-tab-preload.cjs')
}

function createManagedView(id: string, url: string, ownerWindow: BrowserWindow): ManagedBrowserTabView {
  const view = new WebContentsView({
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const managed: ManagedBrowserTabView = { id, url, ownerWindow, view, visible: false }
  managedViews.set(id, managed)
  webContentsToTabId.set(view.webContents.id, id)
  ownerWindow.contentView.addChildView(view)

  view.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    if (!isValidBrowserTabUrl(nextUrl)) {
      console.warn('[业务浏览器] 已拒绝非 http(s) 新窗口链接:', nextUrl)
      return { action: 'deny' }
    }
    const payload: BrowserTabHostMessagePayload = {
      tabId: id,
      message: {
        type: 'proma:open-browser-tab',
        url: nextUrl,
      },
    }
    ownerWindow.webContents.send('browser-tab:host-message', payload)
    return { action: 'deny' }
  })

  view.webContents.on('destroyed', () => {
    managedViews.delete(id)
    webContentsToTabId.delete(view.webContents.id)
  })

  void view.webContents.loadURL(url)
  return managed
}

function shouldShowBrowserTab(bounds: BrowserTabBounds): boolean {
  return bounds.width > 0 && bounds.height > 0
}

function showManagedView(managed: ManagedBrowserTabView, bounds?: BrowserTabBounds): void {
  if (managed.ownerWindow.isDestroyed()) return
  managed.ownerWindow.contentView.addChildView(managed.view)
  if (bounds) {
    managed.view.setBounds(bounds)
  }
  managed.visible = true
  managed.view.setVisible(true)
  managed.view.webContents.focus()
}

function hideManagedView(managed: ManagedBrowserTabView): void {
  managed.visible = false
  managed.view.setVisible(false)
}

function getVisibleBrowserTabForWindow(ownerWindow: BrowserWindow | null | undefined): ManagedBrowserTabView | null {
  if (!ownerWindow || ownerWindow.isDestroyed()) return null

  for (const managed of managedViews.values()) {
    if (managed.ownerWindow === ownerWindow && managed.visible && !managed.view.webContents.isDestroyed()) {
      return managed
    }
  }

  return null
}

function setWebContentsZoom(managed: ManagedBrowserTabView, delta: number): void {
  const currentZoomLevel = managed.view.webContents.getZoomLevel()
  const nextZoomLevel = Math.max(-8, Math.min(currentZoomLevel + delta, 9))
  managed.view.webContents.setZoomLevel(nextZoomLevel)
}

export function dispatchBrowserTabCommandForWindow(
  ownerWindow: BrowserWindow | null | undefined,
  command: BrowserTabCommand,
): boolean {
  const managed = getVisibleBrowserTabForWindow(ownerWindow)
  if (!managed) return false

  if (command === 'reload') {
    managed.view.webContents.reload()
  } else if (command === 'force-reload') {
    managed.view.webContents.reloadIgnoringCache()
  } else if (command === 'toggle-devtools') {
    if (managed.view.webContents.isDevToolsOpened()) {
      managed.view.webContents.closeDevTools()
    } else {
      managed.view.webContents.openDevTools({ mode: 'detach' })
    }
  } else if (command === 'reset-zoom') {
    managed.view.webContents.setZoomLevel(0)
  } else if (command === 'zoom-in') {
    setWebContentsZoom(managed, 0.5)
  } else {
    setWebContentsZoom(managed, -0.5)
  }

  managed.view.webContents.focus()
  return true
}

function getOwnerWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender)
  if (!ownerWindow || ownerWindow.isDestroyed()) return null
  return ownerWindow
}

function removeManagedView(id: string): void {
  const managed = managedViews.get(id)
  if (!managed) return
  managedViews.delete(id)
  webContentsToTabId.delete(managed.view.webContents.id)
  managed.view.setVisible(false)
  if (!managed.ownerWindow.isDestroyed()) {
    managed.ownerWindow.contentView.removeChildView(managed.view)
  }
}

async function ensureBrowserTabView(event: IpcMainInvokeEvent, input: unknown): Promise<void> {
  if (!isEnsureInput(input)) {
    console.warn('[业务浏览器] 收到无效的创建请求:', input)
    return
  }

  const ownerWindow = getOwnerWindow(event)
  if (!ownerWindow) return
  const id = input.id.trim()
  const bounds = normalizeBounds(input.bounds)
  let managed = managedViews.get(id)
  if (!managed || managed.ownerWindow.isDestroyed()) {
    managed = createManagedView(id, input.url, ownerWindow)
  } else if (managed.ownerWindow !== ownerWindow) {
    removeManagedView(id)
    managed = createManagedView(id, input.url, ownerWindow)
  }

  if (managed.url !== input.url) {
    managed.url = input.url
    void managed.view.webContents.loadURL(input.url)
  }
  if (shouldShowBrowserTab(bounds)) {
    showManagedView(managed, bounds)
  } else {
    managed.view.setBounds(bounds)
    hideManagedView(managed)
  }
}

function setBrowserTabBounds(input: unknown): void {
  if (!isBoundsInput(input)) return
  const managed = managedViews.get(input.id.trim())
  if (!managed) return
  const bounds = normalizeBounds(input.bounds)
  managed.view.setBounds(bounds)
  if (shouldShowBrowserTab(bounds)) {
    managed.visible = true
    managed.view.setVisible(true)
  } else {
    hideManagedView(managed)
  }
}

function setBrowserTabVisible(input: unknown, visible: boolean): void {
  if (!isIdInput(input)) return
  const managed = managedViews.get(input.id.trim())
  if (!managed) return
  if (visible) {
    showManagedView(managed)
  } else {
    hideManagedView(managed)
  }
}

function reloadBrowserTab(input: unknown): void {
  if (!isIdInput(input)) return
  const managed = managedViews.get(input.id.trim())
  if (!managed) return
  managed.view.webContents.reload()
}

function destroyBrowserTab(input: unknown): void {
  if (!isIdInput(input)) return
  removeManagedView(input.id.trim())
}

function relayHostMessage(event: IpcMainEvent, message: unknown): void {
  const tabId = webContentsToTabId.get(event.sender.id)
  if (!tabId) return
  const managed = managedViews.get(tabId)
  if (!managed || managed.ownerWindow.isDestroyed()) return
  const payload: BrowserTabHostMessagePayload = { tabId, message }
  managed.ownerWindow.webContents.send('browser-tab:host-message', payload)
}

export function registerBrowserTabViewIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  ipcMain.handle('browser-tab:ensure', ensureBrowserTabView)
  ipcMain.handle('browser-tab:set-bounds', (_, input: unknown) => setBrowserTabBounds(input))
  ipcMain.handle('browser-tab:show', (_, input: unknown) => setBrowserTabVisible(input, true))
  ipcMain.handle('browser-tab:hide', (_, input: unknown) => setBrowserTabVisible(input, false))
  ipcMain.handle('browser-tab:reload', (_, input: unknown) => reloadBrowserTab(input))
  ipcMain.handle('browser-tab:destroy', (_, input: unknown) => destroyBrowserTab(input))
  ipcMain.on('browser-tab:host-message', relayHostMessage)
}
