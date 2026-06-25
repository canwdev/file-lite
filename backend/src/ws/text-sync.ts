import type {
  SharedWsServerMessage,
  TextSyncChannel,
  TextSyncClientMessage,
  TextSyncServerMessage,
  WsErrorMessage,
} from '@frontend/types/server.ts'
import type { WebSocket } from 'ws'
import { Buffer } from 'node:buffer'

const MAX_TEXT_SYNC_LENGTH = 64 * 1024

export interface TextSyncClient {
  ws: WebSocket
}

interface TextSyncChannelState {
  text: string
  clients: Set<TextSyncClient>
}

interface TextSyncControllerOptions {
  sendJson: (ws: WebSocket, payload: SharedWsServerMessage) => void
  sendError: (ws: WebSocket, payload: WsErrorMessage) => void
}

export function createTextSyncController(options: TextSyncControllerOptions) {
  const channelStateMap = new Map<TextSyncChannel, TextSyncChannelState>()
  const clientChannelMap = new Map<TextSyncClient, TextSyncChannel>()

  function cleanupChannelIfEmpty(channel: TextSyncChannel) {
    const state = channelStateMap.get(channel)
    if (state && state.clients.size === 0) {
      channelStateMap.delete(channel)
    }
  }

  function getOrCreateChannelState(channel: TextSyncChannel): TextSyncChannelState {
    const state = channelStateMap.get(channel)
    if (state) {
      return state
    }
    const created: TextSyncChannelState = {
      text: '',
      clients: new Set<TextSyncClient>(),
    }
    channelStateMap.set(channel, created)
    return created
  }

  function joinTextSyncChannel(client: TextSyncClient, channel: TextSyncChannel) {
    const previousChannel = clientChannelMap.get(client)
    if (previousChannel) {
      const prevState = channelStateMap.get(previousChannel)
      prevState?.clients.delete(client)
      cleanupChannelIfEmpty(previousChannel)
    }

    const currentState = getOrCreateChannelState(channel)
    currentState.clients.add(client)
    clientChannelMap.set(client, channel)

    options.sendJson(client.ws, {
      scope: 'text-sync',
      type: 'sync',
      channel,
      text: currentState.text,
    })
  }

  function removeClient(client: TextSyncClient) {
    const channel = clientChannelMap.get(client)
    if (!channel) {
      return
    }
    clientChannelMap.delete(client)
    const state = channelStateMap.get(channel)
    state?.clients.delete(client)
    cleanupChannelIfEmpty(channel)
  }

  function isTextWithinLimit(text: string): boolean {
    return Buffer.byteLength(text, 'utf8') <= MAX_TEXT_SYNC_LENGTH
  }

  function broadcastTextSync(message: TextSyncServerMessage) {
    if (message.type !== 'sync') {
      return
    }
    const state = channelStateMap.get(message.channel)
    if (!state) {
      return
    }
    for (const client of state.clients) {
      options.sendJson(client.ws, message)
    }
  }

  function handleTextSyncUpdate(client: TextSyncClient, payload: Extract<TextSyncClientMessage, { type: 'update' }>) {
    const channel = clientChannelMap.get(client)
    if (!channel || payload.channel !== channel) {
      options.sendError(client.ws, { scope: 'text-sync', type: 'error', message: 'Channel mismatch' })
      return
    }
    if (typeof payload.text !== 'string' || !isTextWithinLimit(payload.text)) {
      options.sendError(client.ws, { scope: 'text-sync', type: 'error', message: `Text exceeds ${MAX_TEXT_SYNC_LENGTH} bytes` })
      return
    }
    const state = getOrCreateChannelState(channel)
    state.text = payload.text
    broadcastTextSync({
      scope: 'text-sync',
      type: 'sync',
      channel,
      text: state.text,
    })
  }

  function handleTextSyncMessage(client: TextSyncClient, payload: TextSyncClientMessage) {
    if (payload.type === 'join') {
      joinTextSyncChannel(client, payload.channel)
      return
    }
    handleTextSyncUpdate(client, payload)
  }

  function clear() {
    channelStateMap.clear()
    clientChannelMap.clear()
  }

  return {
    clear,
    handleTextSyncMessage,
    removeClient,
  }
}
