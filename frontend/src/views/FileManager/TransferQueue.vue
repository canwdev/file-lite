<script setup lang="ts">
import type { UploadConflictPolicy } from '@/api/filesystem'
import type { TaskKind, TaskSnapshot } from '@/types/server'
import type { TaskItem } from '@/utils/task-queue'
import { ViewPortWindow } from '@canwdev/vgo-ui'
import { useStorage } from '@vueuse/core'
import { fsWebApi } from '@/api/filesystem'
import { isDev, LsKeys } from '@/enum'
import { authToken } from '@/store/auth'
import {
  cancelTask,
  dismissTask,
  isTerminalState,
  openConflictDialog,
  openFailureDialog,
  taskList,
} from '@/store/tasks'
import { bytesToSize, downloadUrl } from '@/utils'
import { TaskQueue } from '@/utils/task-queue'
import { useVirtualList } from './ExplorerUI/hooks/use-virtual-files'
import { showInputPrompt } from './ExplorerUI/input-prompt'

const props = withDefaults(
  defineProps<{
    autoClose?: boolean
  }>(),
  {
    autoClose: false,
  },
)
const emit = defineEmits(['allDone', 'singleDone'])

export interface IBatchFile {
  file?: File
  // 绝对路径
  path: string
  filename?: string
  // 已知的文件大小（下载来自目录列表，上传来自 File.size）
  size?: number
  // 下载时使用的父级目录句柄
  parentHandle?: FileSystemDirectoryHandle
  type?: 'upload' | 'download'
  // 上传同名冲突策略，由 useTransfer 在预检弹窗后决定
  onConflict?: UploadConflictPolicy
}

export interface ITransferItem extends IBatchFile {
  // 任务的序号
  index: number
  // 进度(0-1)
  progress: number
  // 状态
  status: 'success' | 'failed' | 'pending' | 'transferring'
  // 错误信息
  message: string
  // 过程中的abort对象
  abortObj?: { abort: () => void }
  // 成功后返回的结果
  result?: any
  speedInfo?: {
    loaded: number
    total: number
    rate: number
    bytes: number
  }
}

// ---- 服务端异步任务（复制 / 移动 / 删除 / 复制副本）----
// 进度由服务端通过 WS 推送，这里只负责渲染进度条和操作入口。
const serverTasks = computed(() => taskList.value)
const hasServerActive = computed(() => serverTasks.value.some(task => !isTerminalState(task.state)))

watch(
  () => serverTasks.value.length,
  (length, previous) => {
    if (length > (previous ?? 0)) {
      isVisible.value = true
    }
  },
)

function kindIcon(kind: TaskKind) {
  switch (kind) {
    case 'move':
      return 'file-move-outline'
    case 'delete':
      return 'delete-outline'
    case 'duplicate':
      return 'content-duplicate'
    default:
      return 'content-copy'
  }
}

function kindLabel(kind: TaskKind) {
  switch (kind) {
    case 'move':
      return 'Moving'
    case 'delete':
      return 'Deleting'
    case 'duplicate':
      return 'Duplicating'
    default:
      return 'Copying'
  }
}

function serverTaskProgress(task: TaskSnapshot) {
  const { bytesTotal, bytesDone, itemsTotal, itemsDone } = task.progress
  if (bytesTotal > 0) {
    return Math.min(bytesDone / bytesTotal, 1)
  }
  if (itemsTotal > 0) {
    return Math.min(itemsDone / itemsTotal, 1)
  }
  return isTerminalState(task.state) && task.state === 'succeeded' ? 1 : 0
}

function serverTaskTarget(task: TaskSnapshot) {
  return task.toPath || task.fromPaths.join(', ')
}

function serverTaskTitle(task: TaskSnapshot) {
  const count = task.progress.itemsTotal || task.fromPaths.length
  return `${kindLabel(task.kind)} ${count} item(s)`
}

function serverTaskMessage(task: TaskSnapshot) {
  switch (task.state) {
    case 'queued':
      return 'Waiting'
    case 'scanning':
      return 'Preparing...'
    case 'awaiting-conflict':
      return 'Waiting for your decision'
    case 'succeeded':
      return 'Done'
    case 'cancelled':
      return 'Cancelled'
    case 'failed':
      return task.error || 'Failed'
    case 'partial': {
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
      const done = task.progress.itemsDone
      const total = task.progress.itemsTotal
      const bytes = task.progress.bytesTotal > 0
        ? ` · ${bytesToSize(task.progress.bytesDone)} / ${bytesToSize(task.progress.bytesTotal)}`
        : ''
      return total > 0 ? `${done} / ${total}${bytes}` : kindLabel(task.kind)
    }
  }
}

// shallowRef：列表项是普通对象，字段改动本身不触发重渲染，统一由 rAF 里的 triggerRef
// 每帧通知一次。否则下载大量小文件时每完成一个就整窗重渲染，UI 会被刷到点不动按钮。
const listData = shallowRef<ITransferItem[]>([])
const isVisible = ref(false)
const transferIndex = ref(0)
const taskQueueRef = ref()
const transferListRef = ref<HTMLElement | null>(null)
const transferItemHeight = ref(54)
const virtualTransferList = useVirtualList({
  items: listData,
  containerRef: transferListRef,
  itemHeight: transferItemHeight,
  overscan: 8,
})
watch(
  () => virtualTransferList.visibleItems.value.length,
  () => nextTick(measureTransferItemHeight),
  { immediate: true },
)

function measureTransferItemHeight() {
  const itemEl = transferListRef.value?.querySelector<HTMLElement>('.transfer-item')
  if (!itemEl) {
    return
  }

  const measuredHeight = itemEl.offsetHeight
  if (measuredHeight > 0 && Math.abs(measuredHeight - transferItemHeight.value) > 1) {
    transferItemHeight.value = measuredHeight
    virtualTransferList.refresh()
  }
}

watch(isVisible, (val) => {
  if (!val) {
    transferIndex.value = 0
    cancelAll()
    listData.value = []
    scheduleFlush()
  }
})

// 所有服务端任务都到终态后自动收起窗口——资源管理器也是这样，
// 否则一个浮动窗口会一直盖在文件列表上挡住操作。
// 注意：这里只隐藏、不 dismiss，任务行仍留在 store 里，可从状态栏重新打开。
const allServerTasksDone = computed(() => {
  return serverTasks.value.length > 0 && serverTasks.value.every(task => isTerminalState(task.state))
})

watch(allServerTasksDone, (done) => {
  if (done && pendingNum.value === 0 && transferringNum.value === 0) {
    isVisible.value = false
  }
})

// 关闭面板：只清理已经结束的服务端任务，仍在运行的保留在 store 里继续跑
function closePanel() {
  for (const task of serverTasks.value) {
    if (isTerminalState(task.state)) {
      void dismissTask(task.id)
    }
  }
  isVisible.value = false
}

function cancelAll() {
  taskQueueRef.value.removeAllTask()
  listData.value.forEach((i) => {
    if (i.status === 'pending' || i.status === 'transferring' || i.abortObj) {
      cancelItem(i)
    }
  })
  // 服务端任务同样受 Cancel All 管辖
  for (const task of serverTasks.value) {
    if (!isTerminalState(task.state)) {
      void cancelTask(task.id)
    }
  }
}

async function cancelItem(item: ITransferItem) {
  dropPending(item)
  item.abortObj?.abort()
  item.abortObj = undefined
  setItemStatus(item, 'failed')
  item.message = 'Cancelled'
}

// ---- 传输进度聚合 ----
// 进度事件（上传每个分片、下载每个 chunk）触发得非常频繁，逐个写入响应式数据会让整个
// 组件反复重渲染。这里先把最新值记在非响应式的 Map 里，再用 requestAnimationFrame
// 每帧统一刷入并重算总量，响应式更新频率收敛到屏幕刷新率。

interface IProgressInfo {
  loaded: number
  total: number
  rate: number
  bytes: number
}

const pendingProgress = new Map<ITransferItem, IProgressInfo>()
const totalBytes = ref(0)
const loadedBytes = ref(0)
const totalRate = ref(0)
const successNum = ref(0)
const errorNum = ref(0)
const transferringNum = ref(0)
const pendingNum = ref(0)
let flushFrame = 0

function itemTotalBytes(item: ITransferItem): number {
  if (item.speedInfo && item.speedInfo.total > 0) {
    return item.speedInfo.total
  }
  // 下载用目录列表带来的 size，上传用 File.size
  if (item.size && item.size > 0) {
    return item.size
  }
  if (item.file && item.file.size > 0) {
    return item.file.size
  }
  return 0
}

function itemLoadedBytes(item: ITransferItem): number {
  if (item.status === 'success') {
    return item.speedInfo?.loaded || item.speedInfo?.total || item.size || item.file?.size || 0
  }
  return item.speedInfo?.loaded || 0
}

function recomputeTotals() {
  let total = 0
  let loaded = 0
  let success = 0
  let failed = 0
  let transferring = 0
  let pending = 0
  const items = listData.value
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    total += itemTotalBytes(item)
    loaded += itemLoadedBytes(item)
    switch (item.status) {
      case 'success':
        success++
        break
      case 'failed':
        failed++
        break
      case 'transferring':
        transferring++
        break
      default:
        pending++
    }
  }
  totalBytes.value = total
  loadedBytes.value = loaded
  successNum.value = success
  errorNum.value = failed
  transferringNum.value = transferring
  pendingNum.value = pending
}

// 总速度按「已传输字节增量 / 时间」计算，而不是累加每个任务的瞬时 rate：
// 小文件常常一个进度事件都来不及刷出就完成了，逐任务 rate 会一直是 0。
let rateSampleLoaded = 0
let rateSampleAt = 0
let rateSmoothed = 0

function updateTotalRate() {
  const loaded = loadedBytes.value
  const active = pendingNum.value > 0 || transferringNum.value > 0
  const now = performance.now()
  if (!active) {
    rateSampleLoaded = loaded
    rateSampleAt = 0
    rateSmoothed = 0
    totalRate.value = 0
    return
  }
  if (rateSampleAt === 0) {
    rateSampleLoaded = loaded
    rateSampleAt = now
    return
  }
  const elapsed = (now - rateSampleAt) / 1000
  if (elapsed < 0.25) {
    return
  }
  const instant = Math.max(loaded - rateSampleLoaded, 0) / elapsed
  rateSmoothed = rateSmoothed > 0 ? rateSmoothed * 0.6 + instant * 0.4 : instant
  rateSampleLoaded = loaded
  rateSampleAt = now
  totalRate.value = rateSmoothed
}

function scheduleFlush() {
  if (flushFrame) {
    return
  }
  flushFrame = requestAnimationFrame(flushProgress)
}

function flushProgress() {
  flushFrame = 0
  if (pendingProgress.size) {
    for (const [item, info] of pendingProgress) {
      item.speedInfo = info
      if (info.total > 0) {
        item.progress = Math.min(info.loaded / info.total, 1)
      }
    }
    pendingProgress.clear()
  }
  recomputeTotals()
  updateTotalRate()
  // 列表项是普通对象，字段改动不触发响应式；这里每帧统一通知一次
  triggerRef(listData)
}

function reportProgress(item: ITransferItem, info: IProgressInfo) {
  pendingProgress.set(item, info)
  scheduleFlush()
}

function dropPending(item: ITransferItem) {
  pendingProgress.delete(item)
}

async function handleUpload(data: ITransferItem, abortController: AbortController) {
  const { path, file, onConflict } = data
  if (!file) {
    throw new Error('File is required for upload')
  }
  await fsWebApi.uploadFile(
    {
      path,
      file,
      onConflict,
    },
    {
      onUploadProgress(event: any) {
        reportProgress(data, {
          loaded: event.loaded,
          total: event.total,
          rate: event.rate,
          bytes: event.bytes,
        })
      },
      signal: abortController.signal,
    },
  )
}

async function handleDownload(data: ITransferItem, abortController: AbortController) {
  const { path, filename, parentHandle } = data
  if (!parentHandle || !filename) {
    throw new Error('parentHandle and filename are required for download')
  }

  // 文件下载逻辑：用 pipeTo 连接网络读与磁盘写，由流标准实现背压，避免读远快于写导致
  // 大量缓冲在浏览器内、到 100% 后 close() 才集中刷盘。
  const response = await fetch(fsWebApi.getStreamUrl(path), {
    headers: {
      Authorization: authToken.value,
    },
    signal: abortController.signal,
  })

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  const body = response.body
  if (!body) {
    throw new Error('Response body is not readable')
  }

  const contentLength = Number.parseInt(response.headers.get('Content-Length') || '0')
  // 没有 Content-Length 时退回目录列表里的 size（仅作兜底，文件可能在列表之后被改动）
  const totalSize = contentLength > 0 ? contentLength : (data.size || 0)
  const fileHandle = await parentHandle.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable({ keepExistingData: false })

  let loaded = 0
  let lastTime = Date.now()
  let lastLoaded = 0

  const tickProgress = (force = false) => {
    const currentTime = Date.now()
    const timeDiff = (currentTime - lastTime) / 1000
    if (!force && timeDiff < 0.5 && loaded !== totalSize)
      return

    const bytesDiff = loaded - lastLoaded
    const rate = timeDiff > 0 ? bytesDiff / timeDiff : 0
    reportProgress(data, {
      loaded,
      total: totalSize,
      rate,
      bytes: bytesDiff,
    })
    lastTime = currentTime
    lastLoaded = loaded
  }

  const progressStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      loaded += chunk.byteLength
      tickProgress()
      controller.enqueue(chunk)
    },
    flush() {
      tickProgress(true)
    },
  })

  try {
    await body.pipeThrough(progressStream).pipeTo(writable, {
      signal: abortController.signal,
    })
  }
  catch (e) {
    await writable.abort().catch(() => {})
    throw e
  }
}

function taskHandler(task: TaskItem) {
  const { data } = task as { data: ITransferItem }
  // console.log('--- taskHandler', task, data)
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    try {
      const { type = 'upload' } = data

      const abortController = new AbortController()
      setItemStatus(data, 'transferring')
      data.abortObj = {
        abort: () => {
          // 上传走「临时文件 + 原子改名」，取消后服务端只会清理自己的临时文件，
          // 目标路径不会出现半成品；这里绝不能去删除目标——它可能是已经上传完成的文件。
          abortController.abort()
        },
      }
      data.message = type === 'upload' ? 'Uploading' : 'Downloading'

      if (type === 'upload') {
        await handleUpload(data, abortController)
      }
      else {
        await handleDownload(data, abortController)
      }

      dropPending(data)
      setItemStatus(data, 'success')
      data.progress = 1
      // 小文件可能一帧内就传完，最后一个进度事件还没刷入；这里补上最终字节，
      // 否则聚合进度会漏掉这些文件，速度和总量都不准。
      const finalSize = data.speedInfo?.total || data.size || data.file?.size || 0
      data.speedInfo = { loaded: finalSize, total: finalSize, rate: 0, bytes: 0 }
      data.abortObj = undefined
      data.message = 'Success'
      emit('singleDone', data)
      resolve(data)
    }
    catch (e: any) {
      // 先把未刷新的进度丢掉，避免失败/取消后又被补写
      dropPending(data)
      if (e.name === 'AbortError') {
        if (data.status !== 'failed') {
          setItemStatus(data, 'failed')
          data.message = 'Cancelled'
          data.abortObj = undefined
        }
        resolve(data)
        return
      }
      console.error(e)
      setItemStatus(data, 'failed')
      data.message = e.message
      data.abortObj = undefined
      reject(e)
    }
  })
}

const concurrentNum = useStorage(LsKeys.CONCURRENT_NUM, 1, localStorage, {
  listenToStorageChanges: false,
})
onMounted(() => {
  taskQueueRef.value = new TaskQueue({
    concurrent: concurrentNum.value,
    taskHandler,
  })
  taskQueueRef.value.on('allDone', () => {
    emit('allDone', listData.value)
    if (props.autoClose) {
      // 直接看列表，避免依赖下一帧才刷新的计数
      if (!listData.value.some(item => item.status === 'failed') && !hasServerActive.value) {
        isVisible.value = false
      }
    }
  })
})
onBeforeUnmount(() => {
  if (flushFrame) {
    cancelAnimationFrame(flushFrame)
    flushFrame = 0
  }
  taskQueueRef.value.removeAllTask()
  taskQueueRef.value = []
})

function addTask(data: IBatchFile, position: number = -1) {
  data = {
    ...data,
    index: ++transferIndex.value,
    progress: 0,
    status: 'pending',
    message: 'Waiting',
    // 重试时清掉上一轮的进度，避免累计字节把总量算错
    speedInfo: undefined,
  } as ITransferItem
  if (position !== -1) {
    listData.value.splice(position, 0, data as ITransferItem)
  }
  else {
    listData.value.push(data as ITransferItem)
  }
  taskQueueRef.value.addTask(data)
  isVisible.value = true
  triggerRef(listData)
  scheduleFlush()
}
function addTasks(data: IBatchFile[]) {
  if (!data.length) {
    return
  }

  const items = data.map((item) => {
    return {
      ...item,
      index: ++transferIndex.value,
      progress: 0,
      status: 'pending',
      message: 'Waiting',
    } as ITransferItem
  })
  // 分块 push：上万条一次性展开会撞上参数个数上限
  const addChunkSize = 5000
  for (let i = 0; i < items.length; i += addChunkSize) {
    listData.value.push(...items.slice(i, i + addChunkSize))
  }
  taskQueueRef.value.addTasks(items)
  isVisible.value = true
  triggerRef(listData)
  scheduleFlush()
}

function handleRetry(item: ITransferItem, index: number) {
  listData.value.splice(index, 1)
  addTask(item, index)
}

function retryAll() {
  // 一次性重建列表并整批入队，避免逐个 splice/insert + addTask 在上万条失败时退化成 O(n²)
  const retried: ITransferItem[] = []
  let failedCount = 0
  const next = listData.value.map((item) => {
    if (item.status !== 'failed') {
      return item
    }
    failedCount++
    const retriedItem = {
      ...item,
      index: ++transferIndex.value,
      progress: 0,
      status: 'pending',
      message: 'Waiting',
      speedInfo: undefined,
      abortObj: undefined,
    } as ITransferItem
    retried.push(retriedItem)
    return retriedItem
  })
  if (!failedCount) {
    return
  }
  listData.value = next
  taskQueueRef.value.addTasks(retried)
  scheduleFlush()
}

function handleManualDownload(item: ITransferItem) {
  const url = fsWebApi.getDownloadUrl([item.path])
  downloadUrl(url, item.filename)
}

onMounted(() => {
  // 仅在开发环境下加载 mock 数据
  const enableMock = false
  if (!(isDev && enableMock))
    return

  const mockList = () => {
    isVisible.value = true
    let index = 0
    const createItem = (overrides: Partial<ITransferItem>): ITransferItem => {
      index++
      const filename = overrides.filename || `mock_file_${index}.png`
      return {
        index,
        path: `D:/TEST/${filename}`,
        filename,
        file: new File([], 'mock.png'),
        progress: 0,
        status: 'pending',
        message: 'Waiting',
        type: 'upload',
        ...overrides,
      }
    }

    listData.value = [
      // 上传状态覆盖
      createItem({ status: 'pending', message: 'Waiting' }),
      createItem({
        status: 'transferring',
        message: 'Uploading',
        progress: 0.45,
        speedInfo: { loaded: 450000, total: 1000000, rate: 102400, bytes: 102400 },
        abortObj: { abort: () => console.log('Abort Upload') },
      }),
      createItem({ status: 'success', message: 'Success', progress: 1 }),
      createItem({ status: 'failed', message: 'Network Error', progress: 0.3 }),

      // 下载状态覆盖
      createItem({ status: 'pending', type: 'download' }),
      createItem({
        status: 'transferring',
        message: 'Downloading',
        type: 'download',
        progress: 0.75,
        speedInfo: { loaded: 750000, total: 1000000, rate: 204800, bytes: 204800 },
        abortObj: { abort: () => console.log('Abort Download') },
      }),
      createItem({ status: 'success', type: 'download', progress: 1 }),
      // Windows 可能对 .url,.dll 等文件名进行限制
      createItem({ status: 'failed', type: 'download', message: `TypeError: Failed to execute 'getFileHandle' on 'FileSystemDirectoryHandle': Name is not allowed.`, progress: 0.8 }),

      // 特殊情况：长文件名
      createItem({
        filename: 'very_long_filename_to_test_ui_truncation_behavior_in_transfer_queue_list_item.png',
        status: 'transferring',
        progress: 0.15,
      }),
    ]
    recomputeTotals()
    triggerRef(listData)
  }
  mockList()
})

const serverBytes = computed(() => {
  let total = 0
  let loaded = 0
  for (const task of serverTasks.value) {
    total += task.progress.bytesTotal
    loaded += Math.min(task.progress.bytesDone, task.progress.bytesTotal || task.progress.bytesDone)
  }
  return { total, loaded }
})

const totalProgress = computed(() => {
  // 有明确字节总量时按 已传输/总量 计算；下载尚未拿到 Content-Length 时退回按条数估算
  const total = totalBytes.value + serverBytes.value.total
  const loaded = loadedBytes.value + serverBytes.value.loaded
  if (total > 0) {
    return Math.min((loaded / total) * 100, 100)
  }
  return listData.value.length ? (successNum.value / listData.value.length) * 100 : 0
})
const totalProgressText = computed(() => `${Number.parseFloat(totalProgress.value.toFixed(2))}%`)
// 队列里还有 pending/transferring 就算活跃，避免并发为 1 时按钮在 Cancel All / Close 之间闪烁
const hasActiveTasks = computed(() => {
  return pendingNum.value > 0 || transferringNum.value > 0 || hasServerActive.value
})
function clearFailed() {
  listData.value = listData.value.filter(i => i.status !== 'failed')
  scheduleFlush()
}
function clearSuccess() {
  listData.value = listData.value.filter(i => i.status !== 'success')
  scheduleFlush()
}

function setItemStatus(item: ITransferItem, status: ITransferItem['status']) {
  if (item.status === status) {
    return
  }

  item.status = status
  // 计数与重渲染都交给每帧一次的 flush
  scheduleFlush()
}

async function setConcurrentNum() {
  const num = await showInputPrompt({
    title: 'Set Concurrent Tasks',
    value: String(concurrentNum.value || 1),
    placeholder: 'Enter the number of concurrent tasks',
    type: 'number',
    validateFn: (val) => {
      const intNum = Number.parseInt(val || '0')
      if (Number.isNaN(intNum) || intNum <= 0) {
        return 'Please enter a positive integer'
      }
    },
  })
  const intNum = Number.parseInt(num)
  concurrentNum.value = intNum
  taskQueueRef.value.concurrent = intNum
}
function show() {
  isVisible.value = true
}

defineExpose({
  addTask,
  addTasks,
  show,
})
</script>

<template>
  <ViewPortWindow
    v-model:visible="isVisible"
    :show-close="!hasActiveTasks"
    :init-win-options="{
      width: '360px',
    }"
    wid="file_lite_upload_dialog"
  >
    <template #titleBarLeft>
      <i-mdi-cloud-sync />
      <div class="vgo-u-flex-wrap-center transfer-header vgo-u-font-code">
        <span v-if="listData.length">[{{ successNum }}/{{ listData.length }}]</span>
        <span v-if="totalBytes > 0">[{{ bytesToSize(loadedBytes) }}/{{ bytesToSize(totalBytes) }}]</span>
        <span v-if="listData.length">[{{ totalProgressText }}]</span>
        <span v-if="totalRate > 0" title="Total speed" class="vgo-u-flex-wrap-center"> <i-mdi-speedometer /> {{ bytesToSize(totalRate) }}/s </span>

        <span v-if="errorNum" title="Failed" class="vgo-u-flex-wrap-center"> <i-mdi-alert-circle class="status-failed" /> {{ errorNum }} </span>
      </div>
    </template>

    <div class="transfer-wrapper">
      <div class="vgo-progress vgo-progress--success total-progress-bar">
        <div :style="{ width: `${totalProgress}%` }" class="vgo-progress__value" />
      </div>

      <div v-if="serverTasks.length" class="server-task-list">
        <div
          v-for="task in serverTasks"
          :key="task.id"
          class="vgo-list-item transfer-item server-task-item"
        >
          <div class="item-main">
            <div class="item-status-icon">
              <template v-if="task.state === 'succeeded'">
                <i-mdi-check-circle class="status-success" />
              </template>
              <template v-else-if="task.state === 'failed' || task.state === 'partial'">
                <i-mdi-alert-circle class="status-failed" />
              </template>
              <template v-else-if="task.state === 'awaiting-conflict'">
                <i-mdi-help-circle-outline class="status-warning" />
              </template>
              <template v-else-if="!isTerminalState(task.state)">
                <i-mdi-loading class="status-active icon-spin" />
              </template>
              <template v-else>
                <MdiIcon class="status-idle" :name="kindIcon(task.kind)" />
              </template>
            </div>

            <div class="item-content">
              <div class="item-title" :title="serverTaskTarget(task)">
                <span class="vgo-u-text-overflow">{{ serverTaskTitle(task) }}</span>
              </div>
              <div class="item-meta">
                <span class="message vgo-u-text-overflow" :title="serverTaskMessage(task)">{{ serverTaskMessage(task) }}</span>
                <span class="percent">{{ (serverTaskProgress(task) * 100).toFixed(0) }}%</span>
              </div>
            </div>

            <div class="item-actions">
              <button
                v-if="task.state === 'awaiting-conflict'"
                class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
                title="Resolve conflict"
                @click="openConflictDialog"
              >
                <i-mdi-help-circle-outline />
              </button>
              <button
                v-if="task.canCancel"
                class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
                title="Cancel"
                @click="cancelTask(task.id)"
              >
                <i-mdi-close />
              </button>
              <button
                v-if="isTerminalState(task.state) && (task.stats.failed + task.stats.conflict) > 0"
                class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
                :title="`${task.stats.failed + task.stats.conflict} item(s) failed — show details`"
                @click="openFailureDialog(task.id)"
              >
                <i-mdi-alert-circle class="status-failed" />
              </button>
              <button
                v-if="isTerminalState(task.state)"
                class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
                title="Dismiss"
                @click="dismissTask(task.id)"
              >
                <i-mdi-check />
              </button>
            </div>
          </div>

          <div
            class="vgo-progress"
            :class="{
              'vgo-progress--success': task.state === 'succeeded',
              'vgo-progress--danger': task.state === 'failed' || task.state === 'partial',
            }"
          >
            <div :style="{ width: `${serverTaskProgress(task) * 100}%` }" class="vgo-progress__value" />
          </div>
        </div>
      </div>

      <div ref="transferListRef" class="transfer-list">
        <div
          v-if="virtualTransferList.beforeHeight.value"
          class="transfer-virtual-spacer"
          :style="{ height: `${virtualTransferList.beforeHeight.value}px` }"
        />
        <div
          v-for="{ item, index } in virtualTransferList.visibleItems.value"
          :key="item.index"
          class="vgo-list-item transfer-item"
        >
          <div class="item-main">
            <div class="item-status-icon">
              <template v-if="item.status === 'success'">
                <i-mdi-check-circle class="status-success" />
              </template>
              <template v-else-if="item.status === 'failed'">
                <i-mdi-alert-circle class="status-failed" />
              </template>
              <template v-else-if="item.status === 'transferring'">
                <i-mdi-loading class="status-active icon-spin" />
              </template>
              <template v-else>
                <MdiIcon
                  class="status-idle"
                  :name="item.type === 'download' ? 'download-outline' : 'upload-outline'"
                />
              </template>
            </div>

            <div class="item-content">
              <div class="item-title" :title="item.path">
                <span class="vgo-u-text-overflow">{{ item.filename || item.path }}</span>
              </div>
              <div class="item-meta">
                <template v-if="item.status === 'transferring' && item.speedInfo">
                  <span class="speed">{{ bytesToSize(item.speedInfo.rate) }}/s</span>
                  <span class="size">{{ bytesToSize(item.speedInfo.loaded) }} / {{ bytesToSize(item.speedInfo.total) }}</span>
                </template>
                <template v-else>
                  <span class="message vgo-u-text-overflow" :title="item.message">{{ item.message }}</span>
                </template>
                <span class="percent">{{ (item.progress * 100).toFixed(0) }}%</span>
              </div>
            </div>

            <div class="item-actions">
              <button
                v-if="item.abortObj"
                class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
                title="Cancel"
                @click="cancelItem(item)"
              >
                <i-mdi-close />
              </button>
              <button
                v-if="item.status === 'failed'"
                class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
                title="Retry"
                @click="handleRetry(item, index)"
              >
                <i-mdi-refresh />
              </button>
              <button
                v-if="item.status === 'failed' && item.type === 'download'"
                class="vgo-button vgo-button--primary vgo-button--icon vgo-button--sm"
                title="Manual Download"
                @click="handleManualDownload(item)"
              >
                <i-mdi-download />
              </button>
            </div>
          </div>

          <div
            class="vgo-progress"
            :class="{
              'vgo-progress--success': item.status === 'success',
              'vgo-progress--danger': item.status === 'failed',
            }"
          >
            <div :style="{ width: `${item.progress * 100}%` }" class="vgo-progress__value" />
          </div>
        </div>
        <div
          v-if="virtualTransferList.afterHeight.value"
          class="transfer-virtual-spacer"
          :style="{ height: `${virtualTransferList.afterHeight.value}px` }"
        />
      </div>
      <div class="transfer-footer">
        <div class="footer-group">
          <span
            v-if="listData.length"
            class="cursor-pointer"
            :title="`Concurrent: ${concurrentNum}, Transferring: ${transferringNum}`"
            @click="setConcurrentNum"
          > <i-mdi-compare-vertical /> {{ transferringNum }} </span>

          <button v-if="errorNum > 0" class="vgo-button vgo-button--primary vgo-button--sm" @click="retryAll">
            Retry All
          </button>
          <button v-if="errorNum > 0" class="vgo-button vgo-button--sm" @click="clearFailed">
            Clear Failed
          </button>
          <button v-if="successNum > 0" class="vgo-button vgo-button--sm" @click="clearSuccess">
            Clear Success
          </button>
        </div>
        <div class="footer-group">
          <button v-if="hasActiveTasks" class="vgo-button vgo-button--danger vgo-button--sm" @click="cancelAll">
            Cancel All
          </button>
          <button v-else class="vgo-button vgo-button--primary vgo-button--sm" @click="closePanel">
            Close
          </button>
        </div>
      </div>
    </div>
  </ViewPortWindow>
</template>

<style scoped lang="scss">
.status-success { color: var(--vgo-success); }
.status-failed { color: var(--vgo-danger); }
.status-active { color: var(--vgo-primary); }
.status-idle { color: var(--vgo-text-secondary); }
.status-warning { color: var(--vgo-warning); }

.transfer-header {
  gap: var(--vgo-space-1);
  font-size: var(--vgo-font-sm);

  .vgo-u-flex-wrap-center {
    gap: var(--vgo-space-1);
  }
}
.transfer-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--vgo-surface);

  .total-progress-bar {
    --vgo-progress-height: 3px;

    flex-shrink: 0;
  }

  .server-task-list {
    flex-shrink: 0;
    max-height: 220px;
    overflow-y: auto;
  }

  // 上下行传输与服务端任务（复制 / 移动 / 删除）是同一种行，行样式只写一份。
  // 不能嵌进 .transfer-list：服务端任务在另一个列表容器里，否则会漏掉全部行样式。
  .transfer-item {
    flex-direction: column;
    align-items: stretch;
    min-height: 0;
    padding: 0;
    cursor: default;

    // 这些行不是点击目标，去掉 .vgo-list-item 的悬停底色（多一层 :hover 才压得住主题层）
    &:hover {
      background-color: transparent;
    }

    .item-main {
      display: flex;
      align-items: center;
      gap: var(--vgo-space-2);
      padding: var(--vgo-space-2) var(--vgo-space-3);
    }

    // 状态图标固定占一列，各行内容才会左右对齐
    .item-status-icon {
      display: flex;
      flex: 0 0 var(--vgo-icon-lg);
      align-items: center;
      justify-content: center;
      font-size: var(--vgo-icon-md);
    }

    .item-content {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
    }

    .item-title {
      display: flex;
      align-items: center;
      min-width: 0;
      font-size: var(--vgo-font-md);
      font-weight: 500;
      color: var(--vgo-text);

      .vgo-u-text-overflow {
        flex: 1;
        min-width: 0;
      }
    }

    .item-meta {
      display: flex;
      align-items: center;
      gap: var(--vgo-space-2);
      min-width: 0;
      font-size: var(--vgo-font-sm);
      color: var(--vgo-text-secondary);

      .message {
        flex: 1;
        min-width: 0;
      }

      .speed,
      .size {
        flex-shrink: 0;
        white-space: nowrap;
      }

      // 百分比靠右成一列，数字等宽才不会随进度左右跳动
      .percent {
        flex-shrink: 0;
        margin-left: auto;
        font-variant-numeric: tabular-nums;
      }
    }

    // 右侧动作区固定留两个图标按钮的宽度，百分比才会对齐成一列；
    // 行里最多只会同时出现两个（重试 / 手动下载，或处理冲突 / 取消）
    .item-actions {
      display: flex;
      flex: 0 0 auto;
      gap: var(--vgo-space-1);
      align-items: center;
      justify-content: flex-end;
      min-width: calc(var(--vgo-control-sm) * 2 + var(--vgo-space-1));
    }
  }

  .transfer-list {
    flex: 1 1 auto;
    min-height: 0;
    max-height: 400px;
    overflow-y: auto;

    .transfer-virtual-spacer {
      pointer-events: none;
    }
  }

  .transfer-footer {
    display: flex;
    flex-wrap: wrap;
    gap: var(--vgo-space-2);
    align-items: center;
    justify-content: space-between;
    margin-top: auto;
    padding: var(--vgo-space-2) var(--vgo-space-3);
    border-top: 1px solid var(--vgo-border);
    background-color: var(--vgo-surface-raised);

    .footer-group {
      display: flex;
      align-items: center;
      gap: var(--vgo-space-2);
      font-size: var(--vgo-font-md);
    }
  }
}
</style>
