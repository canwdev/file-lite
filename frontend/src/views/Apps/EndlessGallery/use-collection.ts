import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'

export interface CollectionItem {
  name: string
  basePath: string
  absPath: string
}

export function useCollection() {
  const collection = useStorage<CollectionItem[]>(LsKeys.COLLECTED_ITEMS, [], localStorage)

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

  /**
   * Remove stale collected items in a directory whose names are no longer
   * present in the given set of existing file names.
   */
  function pruneDirectory(basePath: string, existingNames: Set<string>): void {
    collection.value = collection.value.filter(
      item => item.basePath !== basePath || existingNames.has(item.name),
    )
  }

  return {
    collection,
    isCollected,
    toggleCollect,
    addToCollection,
    removeFromCollection,
    clearCollection,
    getCollectedInDirectory,
    pruneDirectory,
  }
}
