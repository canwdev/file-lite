import type { StorageLikeAsync } from '@vueuse/core'

interface CreateRemoteStorageOptions {
  isEnabled?: () => boolean
  getItem: (key: string) => Promise<unknown>
  setItem: (key: string, value: unknown) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

export function createRemoteStorage(options: CreateRemoteStorageOptions): StorageLikeAsync {
  return {
    async getItem(key) {
      if (options.isEnabled && !options.isEnabled()) {
        return null
      }
      return await options.getItem(key) as string | null
    },
    async setItem(key, value) {
      if (options.isEnabled && !options.isEnabled()) {
        return
      }
      await options.setItem(key, value)
    },
    async removeItem(key) {
      if (options.isEnabled && !options.isEnabled()) {
        return
      }
      await options.removeItem(key)
    },
  } as StorageLikeAsync
}
