const REBUILD_APPROVAL_URL_PATTERN = /\/View\/SupplyGoods\/([^/?#]+)/
const LIFE_PARTNER_HOST_PATTERN = /(^|\.)life-partner\.cn$/

export interface OpenBrowserTabMessage {
  type: 'proma:open-browser-tab'
  url: string
}

export interface ReloadWorkOrdersMessage {
  type: 'proma:reload-work-orders'
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

export function isReloadWorkOrdersMessage(value: unknown): value is ReloadWorkOrdersMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Partial<ReloadWorkOrdersMessage>
  return message.type === 'proma:reload-work-orders'
}

export function buildBrowserTabTitle(url: string): string {
  const matched = url.match(REBUILD_APPROVAL_URL_PATTERN)
  if (matched?.[1]) {
    return `RB审核 · ${decodeURIComponent(matched[1])}`
  }

  try {
    const parsed = new URL(url)
    if (LIFE_PARTNER_HOST_PATTERN.test(parsed.hostname)) {
      const draftId = parsed.searchParams.get('product_draft_cache_id')
        || (/^\/draft\//.test(parsed.pathname) ? parsed.pathname.split('/').filter(Boolean).at(-1) : '')
      return draftId ? `林客草稿 · ${draftId}` : '林客草稿'
    }
    return `网页 · ${parsed.hostname}`
  } catch {
    return '网页'
  }
}
