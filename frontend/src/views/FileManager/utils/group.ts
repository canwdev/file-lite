import type { IEntry } from '../../../types/server'
import type { SortField } from './sort'

export type GroupField = SortField | 'none'

export interface FileGroup {
  id: string
  label: string
  items: IEntry[]
}

export interface GroupKey {
  id: string
  label: string
  order: number | string
}

/** 与 `--vgo-control-md` 对齐，虚拟列表按这个高度算组头。 */
export const GROUP_HEADER_HEIGHT = 30

const DAY_MS = 86_400_000
const KB = 1024
const MB = 1024 * KB
const GB = 1024 * MB

function startOfLocalDay(ms: number) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 本周一起点：周一 00:00（与资源管理器「本周早些时候 / 上周」一致）。 */
function startOfWeekMonday(dayStart: number) {
  const dow = (new Date(dayStart).getDay() + 6) % 7
  return dayStart - dow * DAY_MS
}

export function dateGroupKey(ms: number, now = Date.now()): GroupKey {
  const today = startOfLocalDay(now)
  const day = startOfLocalDay(ms)
  if (day === today)
    return { id: 'date:today', label: $t('file_lite_i18n.today'), order: 8 }
  if (day === today - DAY_MS)
    return { id: 'date:yesterday', label: $t('file_lite_i18n.yesterday'), order: 7 }

  const weekStart = startOfWeekMonday(today)
  if (day >= weekStart)
    return { id: 'date:earlier-this-week', label: $t('file_lite_i18n.earlier_this_week'), order: 6 }
  if (day >= weekStart - 7 * DAY_MS)
    return { id: 'date:last-week', label: $t('file_lite_i18n.last_week'), order: 5 }

  const todayDate = new Date(today)
  const monthStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1).getTime()
  if (day >= monthStart)
    return { id: 'date:earlier-this-month', label: $t('file_lite_i18n.earlier_this_month'), order: 4 }

  const lastMonthStart = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1).getTime()
  if (day >= lastMonthStart)
    return { id: 'date:last-month', label: $t('file_lite_i18n.last_month'), order: 3 }

  const yearStart = new Date(todayDate.getFullYear(), 0, 1).getTime()
  if (day >= yearStart)
    return { id: 'date:earlier-this-year', label: $t('file_lite_i18n.earlier_this_year'), order: 2 }

  const lastYearStart = new Date(todayDate.getFullYear() - 1, 0, 1).getTime()
  if (day >= lastYearStart)
    return { id: 'date:last-year', label: $t('file_lite_i18n.last_year'), order: 1 }

  return { id: 'date:long-ago', label: $t('file_lite_i18n.a_long_time_ago'), order: 0 }
}

export function sizeGroupKey(entry: IEntry): GroupKey {
  if (entry.isDirectory || entry.size === null)
    return { id: 'size:unspecified', label: $t('file_lite_i18n.unspecified'), order: -1 }

  const size = entry.size
  if (size === 0)
    return { id: 'size:empty', label: $t('file_lite_i18n.empty_0_kb'), order: 0 }
  if (size < 16 * KB)
    return { id: 'size:tiny', label: $t('file_lite_i18n.tiny_16_kb'), order: 1 }
  if (size < MB)
    return { id: 'size:small', label: $t('file_lite_i18n.small_1_mb'), order: 2 }
  if (size < 128 * MB)
    return { id: 'size:medium', label: $t('file_lite_i18n.medium_128_mb'), order: 3 }
  if (size < GB)
    return { id: 'size:large', label: $t('file_lite_i18n.large_1_gb'), order: 4 }
  if (size < 4 * GB)
    return { id: 'size:huge', label: $t('file_lite_i18n.huge_4_gb'), order: 5 }
  return { id: 'size:gigantic', label: $t('file_lite_i18n.gigantic_4_gb'), order: 6 }
}

export function nameGroupKey(name: string): GroupKey {
  const ch = (name.trimStart()[0] || '')
  if (!ch)
    return { id: 'name:blank', label: '(Blank)', order: '' }
  if (/\d/.test(ch))
    return { id: 'name:0-9', label: '0-9', order: '0' }
  if (/[a-z]/i.test(ch)) {
    const letter = ch.toUpperCase()
    return { id: `name:${letter}`, label: letter, order: letter }
  }
  return { id: `name:${ch}`, label: ch, order: ch }
}

export function typeGroupKey(entry: IEntry, typeLabel: (entry: IEntry) => string): GroupKey {
  const label = typeLabel(entry)
  return { id: `type:${label}`, label, order: label }
}

export function groupKeyFor(
  entry: IEntry,
  field: SortField,
  options?: { now?: number, typeLabel?: (entry: IEntry) => string },
): GroupKey {
  switch (field) {
    case 'name':
      return nameGroupKey(entry.name)
    case 'extension':
      return typeGroupKey(entry, options?.typeLabel ?? defaultTypeLabel)
    case 'size':
      return sizeGroupKey(entry)
    case 'lastModified':
      return dateGroupKey(entry.lastModified, options?.now)
    case 'birthTime':
      return dateGroupKey(entry.birthtime, options?.now)
  }
}

function defaultTypeLabel(entry: IEntry) {
  if (entry.isDirectory)
    return $t('file_lite_i18n.file_folder')
  const ext = (entry.ext || '').replace(/^\./, '')
  if (!ext)
    return $t('file_lite_i18n.file')
  return `${ext.toUpperCase()} File`
}

function compareOrder(a: number | string, b: number | string) {
  if (typeof a === 'number' && typeof b === 'number')
    return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * 按字段切桶，桶内保持 `files` 的既有顺序（调用方先排好序）。
 * `desc` 只翻转桶与桶之间的顺序。
 */
export function groupEntries(
  files: IEntry[],
  field: SortField,
  desc: boolean,
  options?: { now?: number, typeLabel?: (entry: IEntry) => string },
): FileGroup[] {
  const map = new Map<string, FileGroup & { order: number | string }>()
  for (const file of files) {
    const key = groupKeyFor(file, field, options)
    let group = map.get(key.id)
    if (!group) {
      group = { id: key.id, label: key.label, items: [], order: key.order }
      map.set(key.id, group)
    }
    group.items.push(file)
  }

  const groups = [...map.values()]
  groups.sort((a, b) => {
    const cmp = compareOrder(a.order, b.order)
    return desc ? -cmp : cmp
  })
  return groups.map(({ id, label, items }) => ({ id, label, items }))
}

export function preferredGroupDesc(field: GroupField) {
  return field === 'lastModified' || field === 'birthTime' || field === 'size'
}
