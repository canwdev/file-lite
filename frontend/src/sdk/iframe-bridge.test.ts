import type { SdkInvokePayload } from './broker'
import { describe, expect, test } from 'bun:test'
import { SDK_SOURCE_HOST, SDK_SOURCE_PLUGIN } from './contract'
import { createIframeBridge } from './iframe-bridge'

const ORIGIN = 'http://localhost:8080'

// The bridge reads location.origin the same way the host page does.
Object.defineProperty(globalThis, 'location', {
  value: { origin: ORIGIN },
  configurable: true,
})

interface SentMessage {
  message: Record<string, unknown>
  targetOrigin: string
  transfer?: Transferable[]
}

function fakeWindow() {
  const sent: SentMessage[] = []
  const win = {
    sent,
    postMessage(message: Record<string, unknown>, targetOrigin: string, transfer?: Transferable[]) {
      sent.push({ message, targetOrigin, transfer })
    },
  }
  return win
}

function tick() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function pluginMessage(data: Record<string, unknown>, source: unknown = null) {
  return { origin: ORIGIN, source, data } as unknown as MessageEvent
}

describe('iframe bridge', () => {
  test('ignores messages from another origin, window or source, and non-id requests', async () => {
    const win = fakeWindow()
    const invoke = [] as string[]
    const bridge = createIframeBridge({
      getWindow: () => win as unknown as Window,
      invoke: async (method) => {
        invoke.push(method)
        return undefined
      },
    })

    bridge.handleMessage({ ...pluginMessage({ source: SDK_SOURCE_PLUGIN, id: 1, method: 'list' }), origin: 'http://evil.test' } as unknown as MessageEvent)
    bridge.handleMessage({ ...pluginMessage({ source: SDK_SOURCE_PLUGIN, id: 1, method: 'list' }), source: {} } as unknown as MessageEvent)
    bridge.handleMessage(pluginMessage({ source: 'other', id: 1, method: 'list' }))
    bridge.handleMessage(pluginMessage({ source: SDK_SOURCE_PLUGIN, id: 'x', method: 'list' }))
    await tick()
    expect(invoke).toEqual([])
    expect(win.sent.length).toBe(0)
  })

  test('handles a request and replies with the same id', async () => {
    const win = fakeWindow()
    const calls: SdkInvokePayload[] = []
    const bridge = createIframeBridge({
      getWindow: () => win as unknown as Window,
      invoke: async (method, payload) => {
        expect(method).toBe('list')
        calls.push(payload)
        return [{ name: 'a.txt' }]
      },
    })

    bridge.handleMessage(pluginMessage({ source: SDK_SOURCE_PLUGIN, id: 7, method: 'list', path: '/a' }, win))
    await tick()

    expect(calls).toEqual([{ source: SDK_SOURCE_PLUGIN, id: 7, method: 'list', path: '/a' }])
    expect(win.sent[0]).toEqual({
      message: { source: SDK_SOURCE_HOST, id: 7, error: undefined, data: [{ name: 'a.txt' }] },
      targetOrigin: ORIGIN,
      transfer: [],
    })
  })

  test('hands an ArrayBuffer over instead of copying it', async () => {
    const win = fakeWindow()
    const buffer = new ArrayBuffer(4)
    const bridge = createIframeBridge({
      getWindow: () => win as unknown as Window,
      invoke: async () => buffer,
    })

    bridge.handleMessage(pluginMessage({ source: SDK_SOURCE_PLUGIN, id: 3, method: 'readFile', path: '/a' }, win))
    await tick()
    expect(win.sent[0]?.transfer).toEqual([buffer])
    expect(win.sent[0]?.message.data).toBe(buffer)
  })

  test('maps a failure to an error reply and reports the method', async () => {
    const win = fakeWindow()
    const errors: [string, string][] = []
    const bridge = createIframeBridge({
      getWindow: () => win as unknown as Window,
      invoke: async () => {
        throw new Error('boom')
      },
      onError: (method, message) => errors.push([method, message]),
    })

    bridge.handleMessage(pluginMessage({ source: SDK_SOURCE_PLUGIN, id: 4, method: 'writeFile' }, win))
    await tick()
    expect(win.sent[0]?.message).toEqual({ source: SDK_SOURCE_HOST, id: 4, error: 'boom', data: undefined })
    expect(errors).toEqual([['writeFile', 'boom']])
  })

  test('pushOpen sends path, filename and directory', () => {
    const win = fakeWindow()
    const bridge = createIframeBridge({
      getWindow: () => win as unknown as Window,
      invoke: async () => undefined,
    })

    bridge.pushOpen({ path: '/a/b.txt', filename: 'b.txt', directory: '/a' })
    expect(win.sent[0]?.message).toEqual({
      source: SDK_SOURCE_HOST,
      event: 'open',
      path: '/a/b.txt',
      filename: 'b.txt',
      directory: '/a',
    })
  })

  test('pushOpen without a file sends only the event', () => {
    const win = fakeWindow()
    const bridge = createIframeBridge({
      getWindow: () => win as unknown as Window,
      invoke: async () => undefined,
    })

    bridge.pushOpen(undefined)
    expect(win.sent[0]?.message).toEqual({ source: SDK_SOURCE_HOST, event: 'open' })
  })

  test('does nothing when there is no iframe window', () => {
    const bridge = createIframeBridge({
      getWindow: () => null,
      invoke: async () => undefined,
    })
    bridge.pushOpen({ path: '/a', filename: 'a', directory: '/' })
  })
})
