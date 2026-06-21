import type { Request, Response } from 'express'
import fs from 'node:fs/promises'
import Path from 'node:path'
import express from 'express'
import { getFrontendStorageFilePath } from '@/config/config.ts'

type SettingsStoreValue = null | boolean | number | string | SettingsStoreValue[] | { [key: string]: SettingsStoreValue }
type SettingsStoreMap = Record<string, SettingsStoreValue>

const router = express.Router()

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

async function persistSettingsStore(store: SettingsStoreMap) {
  const filePath = getFrontendStorageFilePath()
  await fs.mkdir(Path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8')
}

function enqueueSettingsStoreWrite(task: () => Promise<void>) {
  const run = settingsStoreWriteQueue.then(task, task)
  settingsStoreWriteQueue = run.catch(() => {})
  return run
}

async function waitForPendingSettingsStoreWrites() {
  await settingsStoreWriteQueue
}

function getRouteKey(req: Request) {
  return req.params.key || ''
}

router.get('/:key', async (req: Request, res: Response) => {
  try {
    const key = getRouteKey(req)
    await waitForPendingSettingsStoreWrites()
    const store = await ensureSettingsStoreLoaded()
    return res.status(200).json({ value: store[key] ?? null })
  }
  catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Failed to read settings' })
  }
})

router.put('/:key', async (req: Request, res: Response) => {
  if (!Object.hasOwn(req.body ?? {}, 'value')) {
    return res.status(400).json({ message: 'value is required' })
  }
  const { value } = req.body as { value: SettingsStoreValue }

  try {
    const key = getRouteKey(req)
    await enqueueSettingsStoreWrite(async () => {
      const currentStore = await ensureSettingsStoreLoaded()
      const nextStore = {
        ...currentStore,
        [key]: value,
      }
      settingsStoreCache = nextStore
      await persistSettingsStore(nextStore)
    })
    return res.status(204).send()
  }
  catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Failed to save settings' })
  }
})

router.delete('/:key', async (req: Request, res: Response) => {
  try {
    const key = getRouteKey(req)
    await enqueueSettingsStoreWrite(async () => {
      const currentStore = await ensureSettingsStoreLoaded()
      if (!(key in currentStore)) {
        return
      }

      const nextStore = { ...currentStore }
      delete nextStore[key]
      settingsStoreCache = nextStore
      await persistSettingsStore(nextStore)
    })
    return res.status(204).send()
  }
  catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Failed to delete settings' })
  }
})

export default router
