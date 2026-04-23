import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'

export interface CollectionItem {
  /** File name */
  name: string
  /** Parent directory path */
  basePath: string
  /** Full absolute path */
  absPath: string
}

export interface CollectionState {
  items: CollectionItem[]
}

const storage = localStorage

export function useCollection() {
  const collection = useStorage<CollectionItem[]>(
    LsKeys.COLLECTED_ITEMS,
    [],
    storage,
  )

  /** Check if a file is collected */
  function isCollected(absPath: string): boolean {
    return collection.value.some(item => item.absPath === absPath)
  }

  /** Toggle collection status for a file */
  function toggleCollect(item: CollectionItem): void {
    const idx = collection.value.findIndex(i => i.absPath === item.absPath)
    if (idx >= 0) {
      collection.value.splice(idx, 1)
    }
    else {
      collection.value.push(item)
    }
  }

  /** Add a file to collection */
  function addToCollection(item: CollectionItem): void {
    if (!isCollected(item.absPath)) {
      collection.value.push(item)
    }
  }

  /** Remove a file from collection */
  function removeFromCollection(absPath: string): void {
    const idx = collection.value.findIndex(i => i.absPath === absPath)
    if (idx >= 0) {
      collection.value.splice(idx, 1)
    }
  }

  /** Clear all collected items */
  function clearCollection(): void {
    collection.value = []
  }

  /** Get collected items in a specific directory */
  function getCollectedInDirectory(basePath: string): CollectionItem[] {
    return collection.value.filter(item => item.basePath === basePath)
  }

  return {
    collection,
    isCollected,
    toggleCollect,
    addToCollection,
    removeFromCollection,
    clearCollection,
    getCollectedInDirectory,
  }
}
