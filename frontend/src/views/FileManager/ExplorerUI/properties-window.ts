import type { IEntry, PropertiesMetaMessage, PropertiesResultMessage } from '@/types/server'
import { computed, ref } from 'vue'
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

/**
 * 多选聚合时每个条目的统计进度。
 *
 * 文件的大小直接来自列表条目；目录的大小 / 条目数只能由服务端后台递归统计，
 * 所以目录是「先占位、测完再填」，`measured` 标记该条进度是否已结束。
 */
export interface PropertiesAggregateItem {
  target: PropertiesTarget
  /** 文件为列表里的字节数；目录为统计出的递归总量，未测完为 null */
  size: number | null
  fileCount: number | null
  folderCount: number | null
  lastModified: number
  birthtime: number
  /** 目录统计是否已结束（出错也算结束） */
  measured: boolean
  /** 统计是否完整（被取消 / 超时则为 false，只保证「至少这么多」） */
  complete: boolean
  error: string | null
}

export const propertiesVisible = ref(false)
/** 单选时的目标；多选聚合时为空。 */
export const propertiesTarget = ref<PropertiesTarget | null>(null)
export const propertiesData = ref<PropertiesInfo>({})
/** 多选聚合时每个选中条目的统计，按选择顺序；非空即表示当前是多选窗口。 */
export const propertiesItems = ref<PropertiesAggregateItem[]>([])
export const propertiesLoading = ref(false)
export const propertiesError = ref<string | null>(null)

/** 多选窗口 = 聚合模式。 */
export const propertiesIsMulti = computed(() => propertiesItems.value.length > 0)

let currentRequestId: string | null = null
/** 多选时待测量的目录下标队列；服务端每个连接同时只跑一个统计，只能串行。 */
let pendingDirectoryIndices: number[] = []
/** 当前正在测量的条目下标。 */
let measuringIndex: number | null = null

function cancelCurrentRequest() {
  if (!currentRequestId) {
    return
  }
  void sendPropertiesCancel(currentRequestId).catch(() => {})
  currentRequestId = null
}

function resetAggregateState() {
  pendingDirectoryIndices = []
  measuringIndex = null
}

function createAggregateItem(target: PropertiesTarget): PropertiesAggregateItem {
  return {
    target,
    // 目录在列表里没有 size，只能等后台统计
    size: target.isDirectory ? null : (target.item?.size ?? null),
    fileCount: null,
    folderCount: null,
    lastModified: target.item?.lastModified || 0,
    birthtime: target.item?.birthtime || 0,
    measured: !target.isDirectory,
    complete: !target.isDirectory,
    error: null,
  }
}

/**
 * 打开属性窗口：窗口立即出现，文件用列表里的本地数据直接展示；
 * 目录的递归大小由服务端后台统计，完成后经 WS 推回刷新（期间显示 Loading...）。
 */
export function openProperties(target: PropertiesTarget) {
  cancelCurrentRequest()
  resetAggregateState()
  propertiesTarget.value = target
  propertiesData.value = {}
  propertiesItems.value = []
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

/**
 * 打开多选聚合窗口：文件立刻计入总量，目录逐个交给服务端后台统计，
 * 每测完一个就把大小与条目数累加进窗口。
 */
export function openPropertiesAggregate(targets: PropertiesTarget[]) {
  cancelCurrentRequest()
  resetAggregateState()
  propertiesTarget.value = null
  propertiesData.value = {}
  propertiesItems.value = targets.map(createAggregateItem)
  propertiesError.value = null
  propertiesVisible.value = true

  pendingDirectoryIndices = propertiesItems.value
    .map((item, index) => (item.measured ? -1 : index))
    .filter(index => index >= 0)

  if (!pendingDirectoryIndices.length) {
    propertiesLoading.value = false
    return
  }
  propertiesLoading.value = true
  measureNextDirectory()
}

/** 串行测量目录：服务端每连接只保留一个统计任务，并发请求会互相取消。 */
function measureNextDirectory() {
  measuringIndex = pendingDirectoryIndices.shift() ?? null
  if (measuringIndex == null) {
    currentRequestId = null
    propertiesLoading.value = false
    return
  }

  const item = propertiesItems.value[measuringIndex]
  if (!item) {
    measureNextDirectory()
    return
  }

  const requestId = newPropertiesRequestId()
  currentRequestId = requestId
  void sendPropertiesGet(requestId, item.target.absPath).catch((error: any) => {
    if (currentRequestId !== requestId) {
      return
    }
    item.error = error?.message || 'Unable to load properties'
    item.measured = true
    measureNextDirectory()
  })
}

function failCurrentAggregate(message: string) {
  const item = measuringIndex == null ? null : propertiesItems.value[measuringIndex]
  if (item) {
    item.error = message
    item.measured = true
    measureNextDirectory()
    return
  }
  propertiesError.value = message
  propertiesLoading.value = false
}

function applyAggregateMessage(msg: PropertiesMetaMessage | PropertiesResultMessage) {
  const item = measuringIndex == null ? null : propertiesItems.value[measuringIndex]
  if (!item) {
    measureNextDirectory()
    return
  }

  if (msg.lastModified) {
    item.lastModified = msg.lastModified
  }
  if (msg.birthtime) {
    item.birthtime = msg.birthtime
  }
  if (msg.type === 'result') {
    item.size = msg.size
    item.fileCount = msg.fileCount ?? null
    item.folderCount = msg.folderCount ?? null
    item.complete = msg.complete
    item.measured = true
    measureNextDirectory()
  }
}

export function closeProperties() {
  cancelCurrentRequest()
  resetAggregateState()
  propertiesVisible.value = false
  propertiesTarget.value = null
  propertiesData.value = {}
  propertiesItems.value = []
  propertiesError.value = null
  propertiesLoading.value = false
}

subscribeSharedWsMessage((msg) => {
  if (msg.scope !== 'properties' || !currentRequestId) {
    return
  }
  if (msg.type === 'error') {
    if (msg.requestId !== currentRequestId) {
      return
    }
    if (propertiesIsMulti.value) {
      failCurrentAggregate(msg.message)
      return
    }
    propertiesError.value = msg.message
    propertiesLoading.value = false
    return
  }
  if (msg.requestId !== currentRequestId) {
    return
  }
  if (propertiesIsMulti.value) {
    applyAggregateMessage(msg)
    return
  }
  propertiesData.value = { ...propertiesData.value, ...msg }
  if (msg.type === 'result') {
    propertiesLoading.value = false
  }
})
