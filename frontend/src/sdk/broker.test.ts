import type { SdkFileApi } from './broker'
import type { SdkHostContext, SdkLaunch } from './contract'
import type { IEntry } from '@/types/server'
import { describe, expect, test } from 'bun:test'
import { baseOf, createSdkBroker, dirOf, toSdkEntry } from './broker'

function entry(name: string, overrides: Partial<IEntry> = {}): IEntry {
  return {
    name,
    path: `/music/${name}`,
    ext: name.includes('.') ? `.${name.split('.').pop()}` : '',
    isDirectory: false,
    hidden: false,
    lastModified: 1,
    birthtime: 1,
    size: 10,
    error: null,
    ...overrides,
  }
}

function fakeFiles(): SdkFileApi & { written: { dir: string, name: string, options?: unknown }[] } {
  const written: { dir: string, name: string, options?: unknown }[] = []
  return {
    written,
    list: async () => [entry('a.mp3'), entry('b.mp3')],
    readBlob: async () => new Blob(['hello']),
    readTextFile: async () => ({ text: 'hi', charset: 'gb18030' }),
    writeFile: async (dir, name, _data, options) => {
      written.push({ dir, name, options })
      if (name === 'fail.txt') {
        return { ok: false, reason: 'read only' }
      }
      if (name === 'both.txt') {
        return { ok: true, path: `${dir}/both (1).txt`, name: 'both (1).txt' }
      }
      return { ok: true, path: `${dir}/${name}`, name }
    },
    url: path => `/api/fs/content/${encodeURIComponent(path)}`,
  }
}

async function rejectionReason(promise: Promise<unknown>) {
  return await promise.then(() => 'resolved', (error: Error) => error.message)
}

function host(launch: SdkLaunch | null = null) {
  const calls: string[] = []
  let current = launch
  const context: SdkHostContext = {
    getLaunch: () => current,
    setLaunch: (next) => {
      current = next
    },
    close: () => calls.push('close'),
    setTitle: title => calls.push(`title:${title}`),
    selectItems: names => calls.push(`select:${names.join(',')}`),
    revealItem: name => calls.push(`reveal:${name}`),
  }
  return { context, calls, launch: () => current }
}

describe('path helpers', () => {
  test('dirOf keeps the parent of a file and the root of a path', () => {
    expect(dirOf('/a/b.txt')).toBe('/a')
    expect(dirOf('/a/')).toBe('/a')
    expect(dirOf('/a')).toBe('/a')
  })

  test('baseOf keeps the file name', () => {
    expect(baseOf('/a/b.txt')).toBe('b.txt')
    expect(baseOf('b.txt')).toBe('b.txt')
  })
})

describe('toSdkEntry', () => {
  test('fills the SDK identity from the directory and the name', () => {
    expect(toSdkEntry('/music', entry('a.mp3'))).toEqual({
      name: 'a.mp3',
      path: '/music/a.mp3',
      ext: '.mp3',
      isDirectory: false,
      hidden: false,
      size: 10,
      lastModified: 1,
      birthtime: 1,
    })
  })

  test('a directory has a null size', () => {
    expect(toSdkEntry('/music', entry('sub', { isDirectory: true, size: null })).size).toBe(null)
  })
})

describe('broker', () => {
  test('list maps every entry', async () => {
    const { context } = host()
    const broker = createSdkBroker(context, fakeFiles())
    const list = await broker.invoke('list', { path: '/music' }) as unknown[]
    expect(list.length).toBe(2)
    expect(list[0]).toEqual(toSdkEntry('/music', entry('a.mp3')))
  })

  test('readFile returns an ArrayBuffer, readText keeps the charset', async () => {
    const { context } = host()
    const broker = createSdkBroker(context, fakeFiles())
    const buffer = await broker.invoke('readFile', { path: '/music/a.mp3' })
    expect(buffer instanceof ArrayBuffer).toBe(true)
    expect(await broker.invoke('readText', { path: '/music/a.mp3' })).toEqual({ text: 'hi', charset: 'gb18030' })
  })

  test('writeFile defaults to overwrite and returns the real path', async () => {
    const files = fakeFiles()
    const { context } = host()
    const broker = createSdkBroker(context, files)
    const result = await broker.invoke('writeFile', {
      path: '/music/save.txt',
      data: new Blob(['x']),
    })
    expect(result).toEqual({ path: '/music/save.txt', name: 'save.txt' })
    expect(files.written).toEqual([{ dir: '/music', name: 'save.txt', options: { conflict: 'overwrite', charset: undefined, onProgress: undefined } }])
  })

  test('writeFile surfaces the keep-both name', async () => {
    const { context } = host()
    const broker = createSdkBroker(context, fakeFiles())
    expect(await broker.invoke('writeFile', { path: '/music/both.txt', data: new Blob(['x']) }))
      .toEqual({ path: '/music/both (1).txt', name: 'both (1).txt' })
  })

  test('writeFile rejects with the server reason', async () => {
    const { context } = host()
    const broker = createSdkBroker(context, fakeFiles())
    expect(await rejectionReason(broker.invoke('writeFile', { path: '/music/fail.txt', data: new Blob(['x']) })))
      .toBe('read only')
  })

  test('url is the stream URL', async () => {
    const { context } = host()
    const broker = createSdkBroker(context, fakeFiles())
    expect(await broker.invoke('url', { path: '/music/a b.mp3' })).toBe('/api/fs/content/%2Fmusic%2Fa%20b.mp3')
  })

  test('window methods are host calls', async () => {
    const calls: string[] = []
    const { context } = host()
    context.close = () => calls.push('close')
    context.setTitle = title => calls.push(`title:${title}`)
    context.selectItems = names => calls.push(`select:${names.join(',')}`)
    context.revealItem = name => calls.push(`reveal:${name}`)
    const broker = createSdkBroker(context, fakeFiles())

    await broker.invoke('setTitle', { title: 'hi' })
    await broker.invoke('selectItems', { names: ['a.mp3', 'b.mp3'] })
    await broker.invoke('revealItem', { name: 'a.mp3' })
    await broker.invoke('exit', {})
    expect(calls).toEqual(['title:hi', 'select:a.mp3,b.mp3', 'reveal:a.mp3', 'close'])
  })

  test('updateLaunch merges and fills filename/directory from path', async () => {
    const { context, launch } = host({
      path: '/a/b.txt',
      filename: 'b.txt',
      directory: '/a',
      entries: [],
    })
    const broker = createSdkBroker(context, fakeFiles())
    await broker.invoke('updateLaunch', { launch: { path: '/a/sub/c.mp3' } })
    expect(launch()).toEqual({ path: '/a/sub/c.mp3', filename: 'c.mp3', directory: '/a/sub', entries: [] })
    await broker.invoke('updateLaunch', { launch: { filename: 'renamed.mp3' } })
    expect(launch()?.filename).toBe('renamed.mp3')
  })

  test('writeFile refuses a missing path or non-binary data', async () => {
    const files = fakeFiles()
    const { context } = host()
    const broker = createSdkBroker(context, files)

    expect(await rejectionReason(broker.invoke('writeFile', { data: new Blob(['x']) })))
      .toBe('writeFile needs a path')
    expect(await rejectionReason(broker.invoke('writeFile', { path: '/a.txt', data: 'text' })))
      .toBe('writeFile needs an ArrayBuffer, a typed array or a Blob')
    expect(await rejectionReason(broker.invoke('writeFile', { path: '/a.txt' })))
      .toBe('writeFile needs an ArrayBuffer, a typed array or a Blob')
    expect(files.written).toEqual([])
  })

  test('unknown methods reject', async () => {
    const { context } = host()
    const broker = createSdkBroker(context, fakeFiles())
    expect(await rejectionReason(broker.invoke('nope', {}))).toBe('unknown method')
  })
})
