import type { MeasurementsMessage, SharedWsServerMessage } from '@/types/server'
import service from '@/utils/service'
import { subscribeSharedWsMessage } from './shared-ws'

/**
 * 目录大小测量（docs/design/api.md §9）。
 *
 * 命令走 HTTP；目录的统计结果由 WebSocket 推（`progress` → `result`）。文件在创建
 * 的时候就已经是终态，所以它不会有推送。
 */
export type MeasurementState = Omit<MeasurementsMessage, 'scope' | 'type'>

export async function createMeasurement(path: string): Promise<MeasurementState> {
  return (await service.post('/api/fs/measurements', { path }, { isToast: false })) as unknown as MeasurementState
}

/** Current state. The create response can be stale, and a push can arrive before the client knows the id. */
export async function getMeasurement(id: string): Promise<MeasurementState> {
  return (await service.get(`/api/fs/measurements/${encodeURIComponent(id)}`, { isToast: false })) as unknown as MeasurementState
}

/** 取消并忘记一个测量。窗口关闭 / 换目标时调用。 */
export async function deleteMeasurement(id: string): Promise<void> {
  await service.delete(`/api/fs/measurements/${encodeURIComponent(id)}`, { isToast: false })
}

/** 订阅测量推送。推送里带 `id`，调用方据此只认自己那一个。 */
export function subscribeMeasurements(listener: (message: MeasurementsMessage) => void) {
  return subscribeSharedWsMessage((message: SharedWsServerMessage) => {
    if (message.scope === 'measurements') {
      listener(message as MeasurementsMessage)
    }
  })
}
