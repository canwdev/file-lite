import type { SdkFileApi } from './broker'
import type { SdkHostContext, SdkLaunch, SdkOpenEvent } from './contract'
import { describe, expect, test } from 'bun:test'
import { createAppSdk } from './use-app-sdk'

function host(launch: SdkLaunch | null = null) {
  let current = launch
  const context: SdkHostContext = {
    getLaunch: () => current,
    setLaunch: (next) => {
      current = next
    },
    close: () => {},
    setTitle: () => {},
    selectItems: () => {},
    revealItem: () => {},
  }
  return context
}

const files: SdkFileApi = {
  list: async () => [],
  readBlob: async () => new Blob([]),
  readTextFile: async () => ({ text: '', charset: '' }),
  writeFile: async (dir, name) => ({ ok: true, path: `${dir}/${name}`, name }),
  url: path => path,
}

const OPEN_A: SdkOpenEvent = { path: '/a/one.txt', filename: 'one.txt', directory: '/a' }
const OPEN_B: SdkOpenEvent = { path: '/a/two.txt', filename: 'two.txt', directory: '/a' }

function tick() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('in-process transport', () => {
  test('delivers every push to subscribers registered before it', () => {
    const transport = createAppSdk(host(), files)
    const seen: (SdkOpenEvent | undefined)[] = []
    transport.sdk.onOpen(open => seen.push(open))

    transport.emitOpen(OPEN_A)
    transport.emitOpen(OPEN_B)
    expect(seen).toEqual([OPEN_A, OPEN_B])
  })

  test('replays the last push to a late subscriber', async () => {
    // Apps are async components: the first time one opens, it subscribes after
    // the window already pushed its launch. Without the replay the editor
    // stayed empty until the file was opened a second time.
    const transport = createAppSdk(host(), files)
    transport.emitOpen(OPEN_A)

    const seen: (SdkOpenEvent | undefined)[] = []
    transport.sdk.onOpen(open => seen.push(open))

    await tick()
    expect(seen).toEqual([OPEN_A])
  })

  test('a late subscriber does not receive a stale push after a newer one', async () => {
    const transport = createAppSdk(host(), files)
    transport.emitOpen(OPEN_A)

    const seen: (SdkOpenEvent | undefined)[] = []
    transport.sdk.onOpen(open => seen.push(open))
    transport.emitOpen(OPEN_B)

    await tick()
    expect(seen).toEqual([OPEN_B])
  })

  test('replays an open without a file as undefined', async () => {
    const transport = createAppSdk(host(), files)
    transport.emitOpen(undefined)

    const seen: (SdkOpenEvent | undefined)[] = []
    transport.sdk.onOpen(open => seen.push(open))

    await tick()
    expect(seen).toEqual([undefined])
  })

  test('a subscriber registered before any push gets no replay', async () => {
    const transport = createAppSdk(host(), files)
    const seen: (SdkOpenEvent | undefined)[] = []
    transport.sdk.onOpen(open => seen.push(open))

    await tick()
    expect(seen).toEqual([])
  })
})
