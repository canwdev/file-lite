import fs from 'node:fs/promises'
import Path from 'node:path'
import { getFrontendStorageFilePath } from '@/config/config.ts'

export type SettingsStoreValue
  = | null
    | boolean
    | number
    | string
    | SettingsStoreValue[]
    | { [key: string]: SettingsStoreValue }

type SettingsStoreMap = Record<string, SettingsStoreValue>

export interface ReloadedSettingsStore {
  previous: SettingsStoreMap
  current: SettingsStoreMap
}

let settingsStoreCache: SettingsStoreMap | null = null
let settingsStoreLoadPromise: Promise<SettingsStoreMap> | null = null
let settingsStoreWriteQueue: Promise<void> = Promise.resolve()

function normalizeSettingsStoreMap(value: unknown): SettingsStoreMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(Object.entries(value)) as SettingsStoreMap
}

async function readSettingsStoreFile(): Promise<SettingsStoreMap> {
  try {
    const content = await fs.readFile(getFrontendStorageFilePath(), 'utf-8')
    return normalizeSettingsStoreMap(JSON.parse(content))
  }
  catch (error: any) {
    if (error?.code === 'ENOENT') {
      return {}
    }
    console.error('Failed to read frontend settings store', error)
    return {}
  }
}

async function ensureSettingsStoreLoaded(): Promise<SettingsStoreMap> {
  if (settingsStoreCache) {
    return settingsStoreCache
  }

  if (!settingsStoreLoadPromise) {
    settingsStoreLoadPromise = readSettingsStoreFile()
      .then((store) => {
        settingsStoreCache = store
        return store
      })
      .finally(() => {
        settingsStoreLoadPromise = null
      })
  }

  return settingsStoreLoadPromise
}

function cloneSettingsStoreMap(store: SettingsStoreMap): SettingsStoreMap {
  return { ...store }
}

async function persistSettingsStore(store: SettingsStoreMap) {
  const filePath = getFrontendStorageFilePath()
  await fs.mkdir(Path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8')
}

function enqueueSettingsStoreWrite<T>(task: () => Promise<T>) {
  const run = settingsStoreWriteQueue.then(task, task)
  settingsStoreWriteQueue = run.then(() => {}, () => {})
  return run
}

export async function waitForPendingSettingsStoreWrites() {
  await settingsStoreWriteQueue
}

export async function getSettingsValue(key: string): Promise<SettingsStoreValue | null> {
  await waitForPendingSettingsStoreWrites()
  const store = await ensureSettingsStoreLoaded()
  return store[key] ?? null
}

export async function getAllSettingsValues(): Promise<SettingsStoreMap> {
  await waitForPendingSettingsStoreWrites()
  const store = await ensureSettingsStoreLoaded()
  return cloneSettingsStoreMap(store)
}

export async function reloadSettingsStore(): Promise<ReloadedSettingsStore> {
  await waitForPendingSettingsStoreWrites()
  const previous = settingsStoreCache ? cloneSettingsStoreMap(settingsStoreCache) : cloneSettingsStoreMap(await ensureSettingsStoreLoaded())
  const current = cloneSettingsStoreMap(await readSettingsStoreFile())
  settingsStoreCache = current
  settingsStoreLoadPromise = null
  return {
    previous,
    current,
  }
}

export async function setSettingsValue(key: string, value: SettingsStoreValue): Promise<SettingsStoreValue> {
  return await enqueueSettingsStoreWrite(async () => {
    const currentStore = await ensureSettingsStoreLoaded()
    const nextStore = {
      ...currentStore,
      [key]: value,
    }
    await persistSettingsStore(nextStore)
    settingsStoreCache = nextStore
    return value
  })
}

export async function deleteSettingsValue(key: string): Promise<null> {
  return await enqueueSettingsStoreWrite(async () => {
    const currentStore = await ensureSettingsStoreLoaded()
    if (!(key in currentStore)) {
      return null
    }

    const nextStore = { ...currentStore }
    delete nextStore[key]
    await persistSettingsStore(nextStore)
    settingsStoreCache = nextStore
    return null
  })
}
