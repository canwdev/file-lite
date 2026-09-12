import type { IEntry, PropertiesMetaMessage } from '@/types/server'
import { ref } from 'vue'
import { newPropertiesRequestId, sendPropertiesCancel, sendPropertiesGet } from '@/api/properties-ws'
import { subscribeSharedWsMessage } from '@/api/shared-ws'

/** meta 与 result 合并后的窗口数据；type 只用于区分阶段。 */
export type PropertiesInfo = Partial<Omit<PropertiesMetaMessage, 'type'>> & { type?: 'meta' | 'result' }

export interface PropertiesTarget {
  /** 目标的绝对路径（行选中来自 basePath + name，空白处来自当前目录） */
  absPath: string
  name: string
  isDirectory: boolean
  ext?: string
  isLink?: boolean
  /** 列表行选中时的原始条目：窗口出现的第一帧就能显示图标与时间 */
  item?: IEntry
}

export const propertiesVisible = ref(false)
export const propertiesTarget = ref<PropertiesTarget | null>(null)
export const propertiesData = ref<PropertiesInfo>({})
export const propertiesLoading = ref(false)
export const propertiesError = ref<string | null>(null)

let currentRequestId: string | null = null

function cancelCurrentRequest() {
  if (!currentRequestId) {
    return
  }
  void sendPropertiesCancel(currentRequestId).catch(() => {})
  currentRequestId = null
}

/**
 * 打开属性窗口：窗口立即出现，文件用列表里的本地数据直接展示；
 * 目录的递归大小由服务端后台统计，完成后经 WS 推回刷新（期间显示 Loading...）。
 */
export function openProperties(target: PropertiesTarget) {
  cancelCurrentRequest()
  propertiesTarget.value = target
  propertiesData.value = {}
  propertiesError.value = null
  propertiesVisible.value = true

  if (!target.isDirectory) {
    propertiesLoading.value = false
    return
  }

  propertiesLoading.value = true
  const requestId = newPropertiesRequestId()
  currentRequestId = requestId
  void sendPropertiesGet(requestId, target.absPath).catch((error: any) => {
    if (currentRequestId !== requestId) {
      return
    }
    propertiesError.value = error?.message || 'Unable to load properties'
    propertiesLoading.value = false
  })
}

export function closeProperties() {
  cancelCurrentRequest()
  propertiesVisible.value = false
  propertiesTarget.value = null
  propertiesData.value = {}
  propertiesError.value = null
  propertiesLoading.value = false
}

subscribeSharedWsMessage((msg) => {
  if (msg.scope !== 'properties' || !currentRequestId) {
    return
  }
  if (msg.type === 'error') {
    if (msg.requestId === currentRequestId) {
      propertiesError.value = msg.message
      propertiesLoading.value = false
    }
    return
  }
  if (msg.requestId !== currentRequestId) {
    return
  }
  propertiesData.value = { ...propertiesData.value, ...msg }
  if (msg.type === 'result') {
    propertiesLoading.value = false
  }
})
