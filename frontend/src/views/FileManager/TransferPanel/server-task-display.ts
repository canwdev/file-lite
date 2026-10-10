import type { TaskKind, TaskSnapshot } from '@/types/server'
import { bytesToSize } from '@/utils'

/**
 * 后台任务行的展示规则。
 *
 * 抽成纯函数是为了让行组件保持无状态、可复用——同一套文案也能给
 * 状态栏角标或以后的通知用。
 */

export function taskKindIcon(kind: TaskKind) {
  switch (kind) {
    case 'move':
      return 'file-move-outline'
    case 'delete':
      return 'delete-outline'
    case 'duplicate':
      return 'content-duplicate'
    case 'compress':
      return 'archive-arrow-up-outline'
    case 'extract':
      return 'archive-arrow-down-outline'
    default:
      return 'content-copy'
  }
}

export function taskKindLabel(kind: TaskKind) {
  switch (kind) {
    case 'move':
      return $t('file_lite_i18n.moving')
    case 'delete':
      return $t('file_lite_i18n.deleting')
    case 'duplicate':
      return $t('file_lite_i18n.duplicating')
    case 'compress':
      return $t('file_lite_i18n.compressing')
    case 'extract':
      return $t('file_lite_i18n.extracting')
    default:
      return $t('file_lite_i18n.copying')
  }
}

/** 0-1 的进度：有字节总量就按字节，否则按条目数（删除任务就没有字节总量）。 */
export function taskProgress(task: TaskSnapshot) {
  // A finished delete often never gets a progress tick, so itemsDone stays 0
  // and the row would read "Done 0%".
  if (task.state === 'succeeded') {
    return 1
  }
  const { bytesTotal, bytesDone, itemsTotal, itemsDone } = task.progress
  if (bytesTotal > 0) {
    return Math.min(bytesDone / bytesTotal, 1)
  }
  if (itemsTotal > 0) {
    return Math.min(itemsDone / itemsTotal, 1)
  }
  return 0
}

export function taskTarget(task: TaskSnapshot) {
  return task.toPath || task.fromPaths.join(', ')
}

export function taskTitle(task: TaskSnapshot) {
  const count = task.progress.itemsTotal || task.fromPaths.length
  return `${taskKindLabel(task.kind)} ${count} item(s)`
}

export function taskMessage(task: TaskSnapshot) {
  switch (task.state) {
    case 'queued':
      return $t('file_lite_i18n.waiting')
    case 'scanning':
      return 'Preparing...'
    case 'awaiting-conflict':
      return $t('file_lite_i18n.waiting_for_confirmation')
    case 'succeeded':
      return $t('file_lite_i18n.done')
    case 'failed':
      return task.error || $t('file_lite_i18n.failed')
    case 'partial': {
      if (task.error)
        return task.error
      const parts = [`${task.stats.succeeded} done`]
      if (task.stats.skipped)
        parts.push(`${task.stats.skipped} skipped`)
      if (task.stats.failed)
        parts.push(`${task.stats.failed} failed`)
      if (task.stats.conflict)
        parts.push(`${task.stats.conflict} conflicted`)
      return parts.join(', ')
    }
    default: {
      if (task.progress.indeterminate)
        return 'Working...'
      const done = task.progress.itemsDone
      const total = task.progress.itemsTotal
      const bytes = task.progress.bytesTotal > 0
        ? ` · ${bytesToSize(task.progress.bytesDone)} / ${bytesToSize(task.progress.bytesTotal)}`
        : ''
      return total > 0 ? `${done} / ${total}${bytes}` : taskKindLabel(task.kind)
    }
  }
}
