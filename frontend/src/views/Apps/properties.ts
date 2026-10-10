import type { MaybeRefOrGetter } from 'vue'
import type { AppParams } from './apps'
import type { MeasurementState } from '@/api/measurements'
import type { IEntry, MeasurementsMessage } from '@/types/server'
import { computed, onScopeDispose, ref, toValue, watch } from 'vue'
import { createMeasurement, deleteMeasurement, getMeasurement, subscribeMeasurements } from '@/api/measurements'
import { InternalAppEnum } from './apps'
import { openAppWindow } from './apps-store'

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

function directoryOf(path: string) {
  const trimmed = path.replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  if (slash <= 0) {
    return '/'
  }
  return trimmed.slice(0, slash)
}

function targetToEntry(target: PropertiesTarget): IEntry {
  return {
    name: target.name,
    path: target.absPath,
    ext: target.ext ?? target.item?.ext ?? '',
    isDirectory: target.isDirectory,
    isLink: target.isLink ?? target.item?.isLink,
    hidden: target.item?.hidden ?? false,
    lastModified: target.item?.lastModified ?? 0,
    birthtime: target.item?.birthtime ?? 0,
    size: target.isDirectory ? null : (target.item?.size ?? null),
    error: null,
  }
}

/** Open the Properties app for one item or an aggregated selection. */
export function showProperties(targets: PropertiesTarget[]) {
  if (!targets.length) {
    return
  }
  const entries = targets.map(targetToEntry)
  openAppWindow(InternalAppEnum.Properties, {
    absPath: targets[0].absPath,
    item: entries[0],
    basePath: directoryOf(targets[0].absPath),
    list: entries,
  })
}

export function propertiesTargetsFromParams(params: AppParams): PropertiesTarget[] {
  const entries = params.list.length ? params.list : [params.item]
  return entries.map(entry => ({
    absPath: entry.path || params.absPath,
    name: entry.name,
    isDirectory: entry.isDirectory,
    ext: entry.ext,
    isLink: entry.isLink,
    item: entry,
  }))
}

/** REST 的创建响应没有 scope/type：补一个，让模板只认一种形状。 */
function toPropertiesInfo(state: MeasurementState): PropertiesInfo {
  return { ...state, type: state.complete ? 'result' : 'progress' }
}

/** A websocket `result`, or a REST body whose walk already finished. */
function isTerminalMeasurement(state: PropertiesInfo) {
  return state.type === 'result' || state.complete === true
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
 * Measure the given targets for as long as the caller is mounted.
 * A new target list cancels the walk that was in progress.
 */
export function useProperties(source: MaybeRefOrGetter<PropertiesTarget[]>) {
  /** 单选时的目标；多选聚合时为空。 */
  const propertiesTarget = ref<PropertiesTarget | null>(null)
  const propertiesData = ref<PropertiesInfo>({})
  /** 多选聚合时每个选中条目的统计，按选择顺序；非空即表示当前是多选窗口。 */
  const propertiesItems = ref<PropertiesAggregateItem[]>([])
  const propertiesLoading = ref(false)
  const propertiesError = ref<string | null>(null)
  /** 多选窗口 = 聚合模式。 */
  const propertiesIsMulti = computed(() => propertiesItems.value.length > 0)

  /** 当前测量的 id；推送里带的是它，不匹配的先存下来，等 POST 带回 id 再对上。 */
  let currentMeasurementId: string | null = null
  /**
   * 打开序号。POST 还没回来时目标又换了，用它认出「没人要的测量」并删掉，
   * 否则它会一直在后台走完。
   */
  let openSequence = 0
  /** 多选时待测量的目录下标队列；窗口一次只测一个，聚合结果才好逐个累加。 */
  let pendingDirectoryIndices: number[] = []
  /** 当前正在测量的条目下标。 */
  let measuringIndex: number | null = null
  /**
   * Pushes that arrived before the create response recorded the id.
   * A local folder often finishes in that gap, and dropping the result leaves the
   * window on "Measuring folders… 0 / N" forever.
   */
  const earlyMeasurements = new Map<string, MeasurementsMessage>()

  function rememberMeasurement(message: MeasurementsMessage) {
    if (!message.id) {
      return
    }
    earlyMeasurements.set(message.id, message)
    while (earlyMeasurements.size > 8) {
      const oldest = earlyMeasurements.keys().next().value
      if (oldest === undefined) {
        break
      }
      earlyMeasurements.delete(oldest)
    }
  }

  function takeEarlyMeasurement(id: string) {
    const message = earlyMeasurements.get(id)
    earlyMeasurements.delete(id)
    return message
  }

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
    earlyMeasurements.clear()
  }

  /** The create call is still the one this window is waiting on. */
  function stillPending(id: string) {
    if (currentMeasurementId !== id) {
      return false
    }
    if (propertiesIsMulti.value) {
      const item = measuringIndex == null ? null : propertiesItems.value[measuringIndex]
      return !!item && !item.measured
    }
    return propertiesLoading.value
  }

  /**
   * Start one measurement and collect its result.
   *
   * The server pushes `progress` and `result` as soon as the walk allows, which
   * can be before this POST resolves. Those frames are kept by id and replayed
   * here. If the create body is still incomplete and nothing arrived on the
   * socket, one GET picks up a walk that finished during the round trip.
   */
  function followMeasurement(path: string, sequence: number, onError: (error: any) => void) {
    void createMeasurement(path).then(async (created) => {
      if (sequence !== openSequence) {
        void deleteMeasurement(created.id).catch(() => {})
        return
      }
      currentMeasurementId = created.id
      adoptMeasurement(toPropertiesInfo(created))
      if (!stillPending(created.id)) {
        return
      }
      const early = takeEarlyMeasurement(created.id)
      if (early) {
        adoptMeasurement(early)
      }
      if (sequence !== openSequence || !stillPending(created.id)) {
        return
      }
      try {
        const fresh = await getMeasurement(created.id)
        if (sequence !== openSequence || !stillPending(created.id)) {
          return
        }
        adoptMeasurement(toPropertiesInfo(fresh))
      }
      catch {
        // The socket can still deliver the result.
      }
    }).catch((error: any) => {
      if (sequence !== openSequence) {
        return
      }
      onError(error)
    })
  }

  function adoptMeasurement(state: PropertiesInfo) {
    if (!state.id || state.id !== currentMeasurementId) {
      return
    }
    if (propertiesIsMulti.value) {
      applyAggregateState(state)
      return
    }
    propertiesData.value = { ...propertiesData.value, ...state }
    if (isTerminalMeasurement(state)) {
      propertiesLoading.value = false
      currentMeasurementId = null
    }
  }

  /** 把一次测量结果并入当前聚合条目；未完成就什么都不做。 */
  function applyAggregateState(state: PropertiesInfo) {
    const item = measuringIndex == null ? null : propertiesItems.value[measuringIndex]
    if (!item) {
      currentMeasurementId = null
      measureNextDirectory()
      return
    }

    if (state.lastModified) {
      item.lastModified = state.lastModified
    }
    if (state.birthtime) {
      item.birthtime = state.birthtime
    }
    if (!isTerminalMeasurement(state)) {
      return
    }
    item.size = state.size ?? null
    item.fileCount = state.fileCount ?? null
    item.folderCount = state.folderCount ?? null
    item.complete = state.complete ?? false
    item.measured = true
    // Drop the id before the next folder starts, so a late frame for this walk
    // cannot be applied to the following item.
    currentMeasurementId = null
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
    followMeasurement(item.target.absPath, sequence, (error) => {
      item.error = error?.message || $t('file_lite_i18n.unable_to_load_properties')
      item.measured = true
      item.complete = false
      measureNextDirectory()
    })
  }

  function openSingle(target: PropertiesTarget) {
    propertiesTarget.value = target
    propertiesData.value = {}
    propertiesItems.value = []
    propertiesError.value = null

    if (!target.isDirectory) {
      propertiesLoading.value = false
      return
    }

    propertiesLoading.value = true
    followMeasurement(target.absPath, openSequence, (error) => {
      propertiesError.value = error?.message || $t('file_lite_i18n.unable_to_load_properties')
      propertiesLoading.value = false
    })
  }

  function openAggregate(targets: PropertiesTarget[]) {
    propertiesTarget.value = null
    propertiesData.value = {}
    propertiesItems.value = targets.map(createAggregateItem)
    propertiesError.value = null

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

  function start(targets: PropertiesTarget[]) {
    cancelCurrentMeasurement()
    resetAggregateState()
    openSequence += 1
    if (targets.length > 1) {
      openAggregate(targets)
      return
    }
    if (targets.length === 1) {
      openSingle(targets[0])
      return
    }
    propertiesTarget.value = null
    propertiesData.value = {}
    propertiesItems.value = []
    propertiesError.value = null
    propertiesLoading.value = false
  }

  const stopSubscription = subscribeMeasurements((message) => {
    if (currentMeasurementId && message.id === currentMeasurementId) {
      adoptMeasurement(message)
      return
    }
    rememberMeasurement(message)
  })

  watch(() => toValue(source), targets => start(targets), { immediate: true })

  onScopeDispose(() => {
    openSequence += 1
    cancelCurrentMeasurement()
    stopSubscription()
  })

  return {
    propertiesTarget,
    propertiesData,
    propertiesItems,
    propertiesLoading,
    propertiesError,
    propertiesIsMulti,
  }
}
