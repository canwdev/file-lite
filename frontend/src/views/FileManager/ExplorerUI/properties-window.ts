import type { MeasurementState } from '@/api/measurements'
import type { IEntry, MeasurementsMessage } from '@/types/server'
import { computed, ref } from 'vue'
import { createMeasurement, deleteMeasurement, subscribeMeasurements } from '@/api/measurements'

/** 窗口数据：progress 是目录的即时信息，result 是终态（文件直接就是终态）。 */
export type PropertiesInfo = Partial<MeasurementsMessage>

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

/** 当前测量的 id；推送里带的是它，不匹配的一律丢弃。 */
let currentMeasurementId: string | null = null

/**
 * 打开序号。POST 还没回来时用户又打开 / 关闭了窗口，用它认出「没人要的测量」并删掉，
 * 否则它会一直在后台走完。
 */
let openSequence = 0

/** 多选时待测量的目录下标队列；窗口一次只测一个，聚合结果才好逐个累加。 */
let pendingDirectoryIndices: number[] = []
/** 当前正在测量的条目下标。 */
let measuringIndex: number | null = null

function cancelCurrentMeasurement() {
  if (!currentMeasurementId) {
    return
  }
  void deleteMeasurement(currentMeasurementId).catch(() => {})
  currentMeasurementId = null
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

/** REST 的创建响应没有 scope/type：补一个，让模板只认一种形状。 */
function toPropertiesInfo(state: MeasurementState): PropertiesInfo {
  return { ...state, type: state.complete ? 'result' : 'progress' }
}

/**
 * 打开属性窗口：窗口立即出现，文件用列表里的本地数据直接展示；
 * 目录的递归大小由服务端后台统计，完成后经 WS 推回刷新（期间显示 Loading...）。
 */
export function openProperties(target: PropertiesTarget) {
  cancelCurrentMeasurement()
  resetAggregateState()
  const sequence = ++openSequence

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
  void createMeasurement(target.absPath).then((state) => {
    if (sequence !== openSequence) {
      // 窗口已经关了或换了目标：这次测量没人收了
      void deleteMeasurement(state.id).catch(() => {})
      return
    }
    currentMeasurementId = state.id
    propertiesData.value = toPropertiesInfo(state)
    if (state.complete) {
      propertiesLoading.value = false
    }
  }).catch((error: any) => {
    if (sequence !== openSequence) {
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
  cancelCurrentMeasurement()
  resetAggregateState()
  openSequence += 1

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

/** 串行测量目录：逐个累加才好在中途显示「已测完几个」。 */
function measureNextDirectory() {
  measuringIndex = pendingDirectoryIndices.shift() ?? null
  if (measuringIndex == null) {
    currentMeasurementId = null
    propertiesLoading.value = false
    return
  }

  const item = propertiesItems.value[measuringIndex]
  if (!item) {
    measureNextDirectory()
    return
  }

  const sequence = openSequence
  void createMeasurement(item.target.absPath).then((state) => {
    if (sequence !== openSequence) {
      void deleteMeasurement(state.id).catch(() => {})
      return
    }
    currentMeasurementId = state.id
    applyAggregateState(toPropertiesInfo(state))
  }).catch((error: any) => {
    if (sequence !== openSequence) {
      return
    }
    item.error = error?.message || 'Unable to load properties'
    item.measured = true
    measureNextDirectory()
  })
}

/** 把一次测量结果并入当前聚合条目；未完成就什么都不做。 */
function applyAggregateState(state: PropertiesInfo) {
  const item = measuringIndex == null ? null : propertiesItems.value[measuringIndex]
  if (!item) {
    measureNextDirectory()
    return
  }

  if (state.lastModified) {
    item.lastModified = state.lastModified
  }
  if (state.birthtime) {
    item.birthtime = state.birthtime
  }
  if (state.type !== 'result') {
    return
  }
  item.size = state.size ?? null
  item.fileCount = state.fileCount ?? null
  item.folderCount = state.folderCount ?? null
  item.complete = state.complete ?? false
  item.measured = true
  measureNextDirectory()
}

export function closeProperties() {
  openSequence += 1
  cancelCurrentMeasurement()
  resetAggregateState()
  propertiesVisible.value = false
  propertiesTarget.value = null
  propertiesData.value = {}
  propertiesItems.value = []
  propertiesError.value = null
  propertiesLoading.value = false
}

subscribeMeasurements((message) => {
  if (!currentMeasurementId || message.id !== currentMeasurementId) {
    return
  }
  if (propertiesIsMulti.value) {
    applyAggregateState(message)
    return
  }
  propertiesData.value = { ...propertiesData.value, ...message }
  if (message.type === 'result') {
    propertiesLoading.value = false
  }
})
