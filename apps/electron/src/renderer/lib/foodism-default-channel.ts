import type { Channel, ChannelModel } from '@proma/shared'
import { foodismDevFeaturesEnabled } from './foodism-dev-features'

export const FOODISM_DEFAULT_CHANNEL_ID = 'foodism-default-relay'
export const FOODISM_DEFAULT_MODEL_ID = 'claude-opus-4-6'
export const FOODISM_DEFAULT_MODEL_NAME = 'Claude Opus 4.6'
export const FOODISM_DEFAULT_CHANNEL_NAME = '万店引力默认模型'

export function isFoodismDefaultChannel(channel: Channel): boolean {
  return channel.id === FOODISM_DEFAULT_CHANNEL_ID || channel.managedBy === 'foodism-default'
}

export function getSelectableChannelModels(channel: Channel): ChannelModel[] {
  if (!isFoodismDefaultChannel(channel) || foodismDevFeaturesEnabled) return channel.models

  return [{
    id: FOODISM_DEFAULT_MODEL_ID,
    name: FOODISM_DEFAULT_MODEL_NAME,
    enabled: true,
  }]
}

export function getChannelDisplayName(channel: Pick<Channel, 'id' | 'name' | 'managedBy'>): string {
  return isFoodismDefaultChannel(channel as Channel) ? FOODISM_DEFAULT_CHANNEL_NAME : channel.name
}
