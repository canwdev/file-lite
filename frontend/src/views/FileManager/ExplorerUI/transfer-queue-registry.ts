import type { Ref } from 'vue'
import type { IBatchFile } from '../TransferPanel/types'

/**
 * 传输面板全局只有一份：面板由顶栏渲染，客户端队列（上传 / 下载）的状态由它持有。
 *
 * 多标签下每个标签都有自己的上传/下载入口，如果各自渲染一个 `<TransferQueue>`，
 * DOM 里会出现多个 `id="file_lite_transfer_panel"`，面板也会重复。所以改成
 * 「一个面板实例注册自己的 API，所有入口往同一个队列塞任务」。
 */
export interface TransferQueueApi {
  addTask: (data: IBatchFile, position?: number) => void
  addTasks: (data: IBatchFile[]) => void
  toggle: () => void
  isVisible: Ref<boolean>
  totalCount: Ref<number>
  activeCount: Ref<number>
  failedCount: Ref<number>
}

const queue = shallowRef<TransferQueueApi | null>(null)

/** 当前唯一的面板 API；面板卸载后为 null（调用方一律用可选链） */
export const transferQueue = queue

export function registerTransferQueue(api: TransferQueueApi) {
  queue.value = api
}

export function unregisterTransferQueue(api: TransferQueueApi) {
  if (queue.value === api) {
    queue.value = null
  }
}
