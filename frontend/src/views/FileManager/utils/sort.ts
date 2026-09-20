/**
 * 修改自GAGU
 * gagu-front-end/src/utils/sorter.util.ts
 */
import type { IEntry } from '@/types/server'
import { SortType } from '@/types/server'

/** 「文件夹在前」的顺序层：目录始终排在文件前面，与具体排序方式叠加 */
export function foldersFirstSorter(a: IEntry, b: IEntry) {
  return Number(b.isDirectory) - Number(a.isDirectory)
}

export function nameSorter(a: IEntry, b: IEntry) {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

export function nameDescSorter(a: IEntry, b: IEntry) {
  return -a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

export function sizeSorter(a: IEntry, b: IEntry) {
  return (a.size || 0) - (b.size || 0)
}

export function sizeDescSorter(a: IEntry, b: IEntry) {
  return -((a.size || 0) - (b.size || 0))
}

export function extensionSorter(a: IEntry, b: IEntry) {
  return a.ext.localeCompare(b.ext, undefined, { numeric: true, sensitivity: 'base' })
}

export function extensionDescSorter(a: IEntry, b: IEntry) {
  return -a.ext.localeCompare(b.ext, undefined, { numeric: true, sensitivity: 'base' })
}

export function lastModifiedSorter(a: IEntry, b: IEntry) {
  return a.lastModified - b.lastModified
}

export function lastModifiedDescSorter(a: IEntry, b: IEntry) {
  return -(a.lastModified - b.lastModified)
}

export function birthTimeSorter(a: IEntry, b: IEntry) {
  return a.birthtime - b.birthtime
}

export function birthTimeDescSorter(a: IEntry, b: IEntry) {
  return -(a.birthtime - b.birthtime)
}

export const sortMethodMap = {
  // 默认排序的「文件夹在前」由 sortEntries 的 foldersFirst 决定，这里只提供名称顺序
  [SortType.default]: nameSorter,
  [SortType.name]: nameSorter,
  [SortType.nameDesc]: nameDescSorter,
  [SortType.size]: sizeSorter,
  [SortType.sizeDesc]: sizeDescSorter,
  [SortType.extension]: extensionSorter,
  [SortType.extensionDesc]: extensionDescSorter,
  [SortType.lastModified]: lastModifiedSorter,
  [SortType.lastModifiedDesc]: lastModifiedDescSorter,
  [SortType.birthTime]: birthTimeSorter,
  [SortType.birthTimeDesc]: birthTimeDescSorter,
}

/**
 * 与资源管理器一致的列表处理：剔除隐藏/错误项后排序（返回新数组）。
 * `foldersFirst` 为真时先按「目录在前」分层，再套用具体排序方式；
 * 默认排序本身只按名称，所以文件夹在前完全由这个开关决定。
 */
export function sortEntries(
  files: IEntry[],
  sortMode: SortType,
  showHidden: boolean,
  foldersFirst = true,
) {
  const sorter = sortMethodMap[sortMode]
  return files
    .filter(item => showHidden || (!item.hidden && !item.error))
    .sort((a, b) => {
      if (foldersFirst) {
        const typeDirection = foldersFirstSorter(a, b)
        if (typeDirection !== 0)
          return typeDirection
      }
      return sorter(a, b)
    })
}
