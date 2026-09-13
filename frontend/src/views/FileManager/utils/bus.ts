import type { ITransferItem } from '../TransferPanel/types'
import mitt from 'mitt'

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
} as const

// mitt 要求事件表满足 Record<EventType, unknown>，interface 没有隐式索引签名，只能用 type
// eslint-disable-next-line ts/consistent-type-definitions
type ExplorerBusEvents = {
  [ExplorerEvents.REFRESH]: void
  [ExplorerEvents.SELECT_COLLECTED]: { basePath: string, names: string[] }
  [ExplorerEvents.REVEAL_ITEM]: { basePath: string, name: string }
  [ExplorerEvents.DEBUG_TRANSFER]: void
  [ExplorerEvents.TRANSFER_DONE]: ITransferItem[]
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
