import type { ITransferItem } from './types'
import type { TaskState } from '@/types/server'

/**
 * 行图标右下角的状态角标。
 *
 * 主图标回答「这是什么」（上传 / 下载 / 复制 / 移动…），角标回答「进行到哪」。
 * 两者分开之后，任务跑起来时不会因为状态换图标，用户也就不会丢掉任务类型。
 */
export type StatusBadge = 'active' | 'paused' | 'success' | 'failed'

/** 客户端上传 / 下载的状态 → 角标；排队中还没开始，不画。 */
export function transferBadge(status: ITransferItem['status']): StatusBadge | null {
  switch (status) {
    case 'transferring':
      return 'active'
    case 'success':
      return 'success'
    case 'failed':
      return 'failed'
    default:
      return null
  }
}

/** 服务端任务状态 → 角标；`awaiting-conflict` 在等用户决定，等价于暂停。 */
export function taskBadge(state: TaskState): StatusBadge | null {
  switch (state) {
    case 'scanning':
    case 'running':
      return 'active'
    case 'awaiting-conflict':
      return 'paused'
    case 'succeeded':
      return 'success'
    case 'failed':
    case 'partial':
      return 'failed'
    default:
      return null
  }
}
