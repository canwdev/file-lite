import type { ITransferItem } from '../TransferPanel/types'
import type { TaskItemResult, TaskSnapshot } from '@/types/server'
import mitt from 'mitt'

/** 浏览器挂载卷上的复制 / 移动 / 删除跑完后广播的内容。 */
export interface ClientTaskDonePayload {
  task: TaskSnapshot
  results: TaskItemResult[]
}

export const ExplorerEvents = {
  REFRESH: 'REFRESH',
  SELECT_COLLECTED: 'SELECT_COLLECTED',
  REVEAL_ITEM: 'REVEAL_ITEM',
  /** 用 mock 数据打开传输窗口，供 Development 菜单调试界面用。 */
  DEBUG_TRANSFER: 'DEBUG_TRANSFER',
  /**
   * 客户端传输队列跑完了一批。传输面板全局唯一，不再由某一个列表绑定 `@all-done`，
   * 所以改成广播：每个标签按自己的目录过滤，只补丁落在自己目录里的上传。
   */
  TRANSFER_DONE: 'TRANSFER_DONE',
  /**
   * 浏览器挂载卷上的复制 / 移动 / 删除跑完了一批。
   *
   * 这类任务由前端执行（后端解析不了 `/@mounted/...`），没有 `fs changed` 推送，
   * 所以和 TRANSFER_DONE 一样由总线广播，落在本目录的列表自己刷新。
   */
  CLIENT_TASK_DONE: 'CLIENT_TASK_DONE',
} as const

// mitt 要求事件表满足 Record<EventType, unknown>，interface 没有隐式索引签名，只能用 type
// eslint-disable-next-line ts/consistent-type-definitions
type ExplorerBusEvents = {
  [ExplorerEvents.REFRESH]: void
  [ExplorerEvents.SELECT_COLLECTED]: { basePath: string, names: string[] }
  [ExplorerEvents.REVEAL_ITEM]: { basePath: string, name: string }
  [ExplorerEvents.DEBUG_TRANSFER]: void
  [ExplorerEvents.TRANSFER_DONE]: ITransferItem[]
  [ExplorerEvents.CLIENT_TASK_DONE]: ClientTaskDonePayload
}

const explorerBus = mitt<ExplorerBusEvents>()

export default explorerBus

export function useExplorerBusOn<T extends keyof ExplorerBusEvents>(
  event: T,
  fn: (payload: ExplorerBusEvents[T]) => void,
) {
  onMounted(() => {
    explorerBus.on(event, fn)
  })
  onBeforeUnmount(() => {
    explorerBus.off(event, fn)
  })
}
