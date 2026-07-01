/**
 * 业务浏览器 Tab 的专用 preload。
 *
 * 只暴露工单页需要的最小 Host 能力，避免把完整 electronAPI 暴露给外部页面。
 */

import { contextBridge, ipcRenderer } from 'electron'

interface PromaElectronWebviewBridge {
  startSsoLogin: () => void
  openRebuildApproval: (supplyGoodsId: string, productName?: string, title?: string) => void
  reloadWorkOrders: () => void
  openBrowserTab: (url: string) => void
}

const bridge: PromaElectronWebviewBridge = {
  startSsoLogin: () => {
    ipcRenderer.send('browser-tab:host-message', { type: 'proma:start-sso-login' })
  },
  openRebuildApproval: (supplyGoodsId: string, productName?: string, title?: string) => {
    ipcRenderer.send('browser-tab:host-message', {
      type: 'proma:open-rebuild-approval',
      supplyGoodsId,
      productName,
      title,
    })
  },
  reloadWorkOrders: () => {
    ipcRenderer.send('browser-tab:host-message', { type: 'proma:reload-work-orders' })
  },
  openBrowserTab: (url: string) => {
    ipcRenderer.send('browser-tab:host-message', {
      type: 'proma:open-browser-tab',
      url,
    })
  },
}

ipcRenderer.on('browser-tab:app-message', (_event, message: unknown) => {
  window.postMessage(message, window.location.origin)
})

contextBridge.exposeInMainWorld('promaElectronWebview', bridge)
