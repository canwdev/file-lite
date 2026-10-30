import { describe, expect, test } from 'bun:test'
import {
  SDK_METHODS,
  SDK_SOURCE_HOST,
  SDK_SOURCE_PLUGIN,
  SDK_VERSION,
  STREAM_URL_PREFIX,
} from './contract'

/**
 * `frontend/public/plugin-sdk.js` is a standalone page script and cannot import
 * this contract. These assertions keep the duplicate wire constants honest.
 */
const source = await Bun.file(new URL('../../public/plugin-sdk.js', import.meta.url)).text()

function expectContained(text: string) {
  expect(source.includes(text)).toBe(true)
}

describe('plugin SDK client', () => {
  test('uses the contract version and message sources', () => {
    expectContained(`var VERSION = ${SDK_VERSION}`)
    expectContained(`var PLUGIN = '${SDK_SOURCE_PLUGIN}'`)
    expectContained(`var HOST = '${SDK_SOURCE_HOST}'`)
    expectContained(`var STREAM_URL_PREFIX = '${STREAM_URL_PREFIX}'`)
  })

  test('exposes every contract method', () => {
    for (const method of SDK_METHODS) {
      expectContained(method === 'url' ? `${method}: function` : `call('${method}'`)
    }
    expectContained('onOpen: function')
    expectContained('window.fileLiteSDK = {')
    expectContained('window.close = function')
  })

  test('delivers one file object and no legacy fields', () => {
    expectContained('cb(file)')
    expect(source.includes('cb.length')).toBe(false)
    expectContained('filename: data.filename ||')
    expect(source.includes('data.name')).toBe(false)
  })

  test('transfers the written bytes as an ArrayBuffer', () => {
    expectContained('toArrayBuffer(data)')
    expectContained('data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)')
  })
})

/** Run the standalone page script against a fake `window` and keep its transport. */
function loadClient() {
  const ORIGIN = 'http://localhost:8080'
  const sent: Record<string, any>[] = []
  const listeners: ((event: { origin: string, data: unknown }) => void)[] = []
  const win: Record<string, any> = {
    location: { origin: ORIGIN },
    parent: { postMessage: (message: Record<string, any>) => sent.push(message) },
    addEventListener: (type: string, callback: (event: { origin: string, data: unknown }) => void) => {
      if (type === 'message') {
        listeners.push(callback)
      }
    },
  }
  // eslint-disable-next-line no-new-func -- run the standalone page script exactly as the browser does
  new Function('window', source)(win)
  return {
    sdk: win.fileLiteSDK,
    sent,
    dispatch: (data: Record<string, unknown>) => {
      for (const listener of listeners) {
        listener({ origin: ORIGIN, data })
      }
    },
  }
}

function tick() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('plugin SDK client behaviour', () => {
  test('passes one object per open, whatever the callback declares', () => {
    const { sdk, dispatch } = loadClient()
    const calls: unknown[][] = []
    sdk.onOpen((file: unknown) => calls.push([file]))
    // A leftover two-parameter callback must not receive the old (path, name) pair.
    sdk.onOpen((first: unknown, second: unknown) => calls.push([first, second]))
    dispatch({ source: SDK_SOURCE_HOST, event: 'open', path: '/a/b.txt', filename: 'b.txt', directory: '/a' })
    expect(calls).toEqual([
      [{ path: '/a/b.txt', filename: 'b.txt', directory: '/a' }],
      [{ path: '/a/b.txt', filename: 'b.txt', directory: '/a' }, undefined],
    ])
  })

  test('an open without a file is undefined', () => {
    const { sdk, dispatch } = loadClient()
    const calls: unknown[] = []
    sdk.onOpen((file: unknown) => calls.push(file))
    dispatch({ source: SDK_SOURCE_HOST, event: 'open' })
    expect(calls).toEqual([undefined])
  })

  test('correlates a request with its reply by id', async () => {
    const { sdk, sent, dispatch } = loadClient()
    const pending = sdk.list('/music')
    await tick()
    const request = sent[0]!
    expect(request).toEqual({ source: SDK_SOURCE_PLUGIN, id: 1, method: 'list', path: '/music' })
    dispatch({ source: SDK_SOURCE_HOST, id: request.id, data: [{ name: 'a.mp3' }] })
    expect(await pending).toEqual([{ name: 'a.mp3' }])
  })

  test('rejects a reply that carries an error', async () => {
    const { sdk, sent, dispatch } = loadClient()
    const pending = sdk.readFile('/secret')
    await tick()
    dispatch({ source: SDK_SOURCE_HOST, id: sent[0]!.id, error: 'no access' })
    expect(await pending.then(() => 'resolved', (error: Error) => error.message)).toBe('no access')
  })

  test('serialises writeFile data to an ArrayBuffer and forwards options', async () => {
    const { sdk, sent, dispatch } = loadClient()
    const pending = sdk.writeFile('/a.txt', new Blob(['hello']), { conflict: 'keep-both', charset: 'gb18030' })
    await tick()
    const request = sent[0]!
    expect(request.method).toBe('writeFile')
    expect(request.path).toBe('/a.txt')
    expect(request.data instanceof ArrayBuffer).toBe(true)
    expect(request.options).toEqual({ conflict: 'keep-both', charset: 'gb18030' })
    dispatch({ source: SDK_SOURCE_HOST, id: request.id, data: { path: '/a.txt', name: 'a.txt' } })
    expect(await pending).toEqual({ path: '/a.txt', name: 'a.txt' })
  })

  test('builds the stream URL locally and sends launch updates', async () => {
    const { sdk, sent, dispatch } = loadClient()
    expect(sdk.url('/a/b c.txt')).toBe('/api/fs/content/%2Fa%2Fb%20c.txt')
    expect(sdk.url('')).toBe('')

    const pending = sdk.updateLaunch({ path: '/a/c.txt' })
    await tick()
    expect(sent[0]!.launch).toEqual({ path: '/a/c.txt' })
    dispatch({ source: SDK_SOURCE_HOST, id: sent[0]!.id })
    await pending
  })

  test('exposes the contract version and window close', () => {
    const { sdk } = loadClient()
    expect(sdk.version).toBe(SDK_VERSION)
  })
})
