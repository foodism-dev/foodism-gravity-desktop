export interface RefreshTicketMessage {
  type: 'proma:refresh-ticket'
  supplyGoodsIds: string[]
}

export function buildRefreshTicketMessage(supplyGoodsIds: Iterable<string>): RefreshTicketMessage | null {
  const normalizedIds = [...new Set(
    [...supplyGoodsIds]
      .map((supplyGoodsId) => supplyGoodsId.trim())
      .filter(Boolean),
  )]
  if (normalizedIds.length === 0) return null
  return {
    type: 'proma:refresh-ticket',
    supplyGoodsIds: normalizedIds,
  }
}
