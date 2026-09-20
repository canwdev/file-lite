/**
 * 修改自GAGU
 * gagu-front-end/src/utils/sorter.util.ts
 */
import type { IEntry } from '../../../types/server'
import { SortType } from '../../../types/server'

/** 排序字段。方向是另一轴；分组按同一字段切桶。 */
export const SORT_FIELDS = ['name', 'extension', 'size', 'lastModified', 'birthTime'] as const
export type SortField = (typeof SORT_FIELDS)[number]

export const SORT_FIELD_LABELS: Record<SortField, string> = {
  name: 'Name',
  extension: 'Extension',
  size: 'Size',
  lastModified: 'Last Modified',
  birthTime: 'Created Time',
}

const SORT_FIELD_SET = new Set<string>(SORT_FIELDS)

export function parseSortMode(mode: SortType): { field: SortField, desc: boolean } {
  if (mode === SortType.default)
    return { field: 'name', desc: false }

  const desc = mode.endsWith('Desc')
  const field = desc ? mode.slice(0, -4) : mode
  if (!SORT_FIELD_SET.has(field))
    return { field: 'name', desc: false }

  return { field: field as SortField, desc }
}

export function composeSortMode(field: SortField, desc: boolean): SortType {
  return (desc ? `${field}Desc` : field) as SortType
}

/** 「文件夹在前」的顺序层：目录始终排在文件前面，与具体排序方式叠加 */
export function foldersFirstSorter(a: IEntry, b: IEntry) {
  return Number(b.isDirectory) - Number(a.isDirectory)
}

export function nameSorter(a: IEntry, b: IEntry) {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

export function sizeSorter(a: IEntry, b: IEntry) {
  return (a.size || 0) - (b.size || 0)
}

export function extensionSorter(a: IEntry, b: IEntry) {
  return a.ext.localeCompare(b.ext, undefined, { numeric: true, sensitivity: 'base' })
}

export function lastModifiedSorter(a: IEntry, b: IEntry) {
  return a.lastModified - b.lastModified
}

export function birthTimeSorter(a: IEntry, b: IEntry) {
  return a.birthtime - b.birthtime
}

const sortByField: Record<SortField, (a: IEntry, b: IEntry) => number> = {
  name: nameSorter,
  extension: extensionSorter,
  size: sizeSorter,
  lastModified: lastModifiedSorter,
  birthTime: birthTimeSorter,
}

/**
 * 与资源管理器一致的列表处理：剔除隐藏/错误项后排序（返回新数组）。
 * `foldersFirst` 为真时先按「目录在前」分层，再套用字段比较；递减只是把比较结果取反。
 */
export function sortEntries(
  files: IEntry[],
  sortMode: SortType,
  showHidden: boolean,
  foldersFirst = true,
) {
  const { field, desc } = parseSortMode(sortMode)
  const sorter = sortByField[field]
  return files
    .filter(item => showHidden || (!item.hidden && !item.error))
    .sort((a, b) => {
      if (foldersFirst) {
        const typeDirection = foldersFirstSorter(a, b)
        if (typeDirection !== 0)
          return typeDirection
      }
      const cmp = sorter(a, b)
      return desc ? -cmp : cmp
    })
}
