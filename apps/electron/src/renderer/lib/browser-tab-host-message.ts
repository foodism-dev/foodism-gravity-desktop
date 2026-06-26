const REBUILD_APPROVAL_URL_PATTERN = /\/View\/SupplyGoods\/([^/?#]+)/

export interface OpenBrowserTabMessage {
  type: 'proma:open-browser-tab'
  url: string
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function isOpenBrowserTabMessage(value: unknown): value is OpenBrowserTabMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Partial<OpenBrowserTabMessage>
  return message.type === 'proma:open-browser-tab'
    && typeof message.url === 'string'
    && isHttpUrl(message.url)
}

export function buildBrowserTabTitle(url: string): string {
  const matched = url.match(REBUILD_APPROVAL_URL_PATTERN)
  if (matched?.[1]) {
    return `RB审核 · ${decodeURIComponent(matched[1])}`
  }

  try {
    return `网页 · ${new URL(url).hostname}`
  } catch {
    return '网页'
  }
}
