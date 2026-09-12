<script setup lang="ts">
import type { IBatchFile, ITransferItem, TransferTab, TransferTabCounts } from './TransferPanel/types'
import type { TaskItemResult, TaskSnapshot } from '@/types/server'
import type { TaskItem } from '@/utils/task-queue'
import { useStorage } from '@vueuse/core'
import { fsWebApi } from '@/api/filesystem'
import { LsKeys } from '@/enum'
import { authToken } from '@/store/auth'
import {
  cancelTask,
  dismissTask,
  isTerminalState,
  openConflictDialog,
  openFailureDialog,
  removeDebugTasks,
  replaceDebugTasks,
  taskList,
} from '@/store/tasks'
import { bytesToSize, downloadUrl } from '@/utils'
import { TaskQueue } from '@/utils/task-queue'
import { showInputPrompt } from './ExplorerUI/input-prompt'
import ServerTaskList from './TransferPanel/ServerTaskList.vue'
import TransferList from './TransferPanel/TransferList.vue'
import TransferPanel from './TransferPanel/TransferPanel.vue'
import { ExplorerEvents, useExplorerBusOn } from './utils/bus'

/**
 * 传输面板的编排层。
 *
 * 它只管三件事：客户端的上传/下载队列、进度聚合、面板的显示状态。
 * 「长什么样」全部交给 TransferPanel + 两个列表 + 行组件；
 * 那几个组件都不依赖这里，可以单独复用。
 */
const props = withDefaults(
  defineProps<{
    autoClose?: boolean
  }>(),
  {
    autoClose: false,
  },
)
const emit = defineEmits(['allDone', 'singleDone'])

// ---- 客户端的上传 / 下载队列 ----
const listData = shallowRef<ITransferItem[]>([])
const transferIndex = ref(0)
const taskQueueRef = ref()

const pendingProgress = new Map<ITransferItem, { loaded: number, total: number, rate: number, bytes: number }>()
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

// 进度事件（上传每个分片、下载每个 chunk）触发得非常频繁，逐个写入响应式数据会让整个
// 组件反复重渲染。这里先把最新值记在非响应式的 Map 里，再用 rAF 每帧统一刷入并重算。
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

function reportProgress(item: ITransferItem, info: { loaded: number, total: number, rate: number, bytes: number }) {
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
    { path, file, onConflict },
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
    reportProgress(data, { loaded, total: totalSize, rate, bytes: bytesDiff })
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
    if (props.autoClose && !listData.value.some(item => item.status === 'failed') && !hasServerActive.value) {
      // 直接看列表，避免依赖下一帧才刷新的计数
      isVisible.value = false
    }
    if (!isVisible.value) {
      dropFinishedTransfers()
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

function setItemStatus(item: ITransferItem, status: ITransferItem['status']) {
  if (item.status === status) {
    return
  }
  item.status = status
  // 计数与重渲染都交给每帧一次的 flush
  scheduleFlush()
}

// ---- 面板状态 ----
const isVisible = ref(false)
const activeTab = ref<TransferTab>('transfers')
/** 调试视图打开期间：不自动收起、不自动清理，随时可以关掉。 */
const debugMode = ref(false)

const serverTasks = computed(() => taskList.value)
// 调试视图注入的假任务不参与「还有任务在跑」的判断
const realServerTasks = computed(() => serverTasks.value.filter(task => !task.debug))
const hasServerActive = computed(() => realServerTasks.value.some(task => !isTerminalState(task.state)))

const transferCounts = computed<TransferTabCounts>(() => ({
  total: listData.value.length,
  active: pendingNum.value + transferringNum.value,
  failed: errorNum.value,
}))
const taskCounts = computed<TransferTabCounts>(() => ({
  total: serverTasks.value.length,
  active: realServerTasks.value.filter(task => !isTerminalState(task.state)).length,
  failed: serverTasks.value.filter(task => task.stats.failed + task.stats.conflict > 0).length,
}))
const totalCount = computed(() => transferCounts.value.total + taskCounts.value.total)
const activeCount = computed(() => transferCounts.value.active + taskCounts.value.active)
const failedCount = computed(() => transferCounts.value.failed + taskCounts.value.failed)

/** 面板顶部那句话：只统计当前页签，不把两种任务的数字混在一起。 */
const summary = computed(() => {
  if (activeTab.value === 'tasks') {
    const { total, active, failed } = taskCounts.value
    if (!total) {
      return ''
    }
    const parts = [`${total} task(s)`]
    if (active) {
      parts.push(`${active} running`)
    }
    if (failed) {
      parts.push(`${failed} with failures`)
    }
    return parts.join(' · ')
  }

  if (!listData.value.length) {
    return ''
  }
  const parts = [`${successNum.value}/${listData.value.length}`]
  if (totalBytes.value > 0) {
    parts.push(`${bytesToSize(loadedBytes.value)}/${bytesToSize(totalBytes.value)}`)
  }
  if (totalRate.value > 0) {
    parts.push(`${bytesToSize(totalRate.value)}/s`)
  }
  if (errorNum.value) {
    parts.push(`${errorNum.value} failed`)
  }
  return parts.join(' · ')
})

// 所有服务端任务都到终态后自动收起面板——资源管理器也是这样。
const allServerTasksDone = computed(() => {
  return realServerTasks.value.length > 0 && realServerTasks.value.every(task => isTerminalState(task.state))
})

// 新的后台任务一出现就弹出面板并切到任务页签——复制 / 移动 / 删除都可能要跑很久，
// 没有窗口的话用户完全不知道发生了什么。已经在看传输页签时不抢页签。
watch(
  () => realServerTasks.value.filter(task => !isTerminalState(task.state)).length,
  (active, previous) => {
    if (debugMode.value || active <= (previous ?? 0)) {
      return
    }
    if (!isVisible.value) {
      activeTab.value = 'tasks'
    }
    isVisible.value = true
  },
)

watch(allServerTasksDone, (done) => {
  if (debugMode.value || !done || pendingNum.value > 0 || transferringNum.value > 0) {
    return
  }
  isVisible.value = false

  // 顺带把「没有任何问题」的任务从列表里清掉：一次普通复制不该在任务列表里留下
  // 一条记录，否则会越积越多，状态栏的入口也永远亮着。
  // 部分成功 / 失败 / 已取消的保留——用户可能还要看原因或点 Try Again。
  for (const task of realServerTasks.value.filter(item => item.state === 'succeeded')) {
    void dismissTask(task.id)
  }
})

watch(isVisible, (val) => {
  if (val) {
    return
  }
  if (debugMode.value) {
    // 调试数据：只回收自己注入的假任务，绝不能顺手取消用户真实的任务
    exitDebugMode()
  }
  dropFinishedTransfers()
})

/**
 * 收起面板只是隐藏：正在跑的上传/下载继续跑，失败的也留着。
 * 只有已经成功的行没有再看的意义，顺手清掉避免越积越多。
 */
function dropFinishedTransfers() {
  if (!listData.value.some(item => item.status === 'success')) {
    return
  }
  listData.value = listData.value.filter(item => item.status !== 'success')
  scheduleFlush()
}

function toggle() {
  isVisible.value = !isVisible.value
}

// ---- 行上的动作 ----
async function cancelItem(item: ITransferItem) {
  dropPending(item)
  item.abortObj?.abort()
  item.abortObj = undefined
  setItemStatus(item, 'failed')
  item.message = 'Cancelled'
}

/**
 * 重试一行：把它从原位挪回队列。
 *
 * 位置在这里用对象自己找，不让数组下标穿过列表 / 行组件传上来——
 * 行组件的 `item.index` 是「传输序号」，成功行被清掉之后它就不再等于数组下标了。
 */
function handleRetry(item: ITransferItem) {
  const index = listData.value.indexOf(item)
  if (index === -1) {
    return
  }
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

function clearFailed() {
  listData.value = listData.value.filter(i => i.status !== 'failed')
  scheduleFlush()
}

function clearSuccess() {
  listData.value = listData.value.filter(i => i.status !== 'success')
  scheduleFlush()
}

function handleManualDownload(item: ITransferItem) {
  downloadUrl(fsWebApi.getDownloadUrl([item.path]), item.filename)
}

function cancelTransfers() {
  taskQueueRef.value?.removeAllTask()
  for (const item of listData.value) {
    if (item.status === 'pending' || item.status === 'transferring' || item.abortObj) {
      void cancelItem(item)
    }
  }
}

function cancelServerTasks() {
  for (const task of realServerTasks.value) {
    if (!isTerminalState(task.state)) {
      void cancelTask(task.id)
    }
  }
}

function clearFinishedServerTasks() {
  for (const task of serverTasks.value) {
    if (isTerminalState(task.state)) {
      void dismissTask(task.id)
    }
  }
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

// ---- 调试视图（Development 菜单） ----
function debugServerTask(
  id: string,
  overrides: Partial<TaskSnapshot> & { results?: TaskItemResult[] },
) {
  return {
    id: `debug_${id}`,
    kind: 'copy' as const,
    state: 'running' as const,
    fromPaths: ['/mock/source'],
    toPath: '/mock/target/',
    isMove: false,
    progress: { itemsTotal: 0, itemsDone: 0, bytesTotal: 0, bytesDone: 0 },
    stats: { succeeded: 0, skipped: 0, renamed: 0, failed: 0, conflict: 0 },
    canCancel: true,
    createdAt: Date.now(),
    ...overrides,
  }
}

const debugFailureResults: TaskItemResult[] = [
  { fromPath: '/mock/source/report.pdf', status: 'failed', message: 'permission denied' },
  { fromPath: '/mock/source/locked.bin', status: 'conflict', message: 'A conflicting item appeared at the destination' },
]

/**
 * 调试视图：用一组覆盖各种边界情况的假数据填满面板，方便手动检查排版。
 * 由 Development 菜单触发；假任务带 debug 标记，取消 / 移除都只在本地生效。
 */
function loadMockTransferList() {
  debugMode.value = true
  activeTab.value = 'transfers'
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
    // ---- 上传：待处理 / 传输中（有速度）/ 传输中（总量未知）/ 成功 / 失败 ----
    createItem({ status: 'pending', message: 'Waiting' }),
    createItem({
      status: 'transferring',
      message: 'Uploading',
      progress: 0.45,
      speedInfo: { loaded: 450_000, total: 1_000_000, rate: 102_400, bytes: 102_400 },
      abortObj: { abort: () => console.log('Abort Upload') },
    }),
    // 刚开始、还没拿到任何进度
    createItem({
      status: 'transferring',
      message: 'Uploading',
      progress: 0,
      speedInfo: { loaded: 0, total: 0, rate: 0, bytes: 0 },
      abortObj: { abort: () => console.log('Abort Upload') },
    }),
    createItem({ status: 'success', message: 'Success', progress: 1 }),
    createItem({ status: 'failed', message: 'Network Error', progress: 0.3 }),

    // ---- 下载：同样的状态组合 ----
    createItem({ status: 'pending', type: 'download' }),
    createItem({
      status: 'transferring',
      message: 'Downloading',
      type: 'download',
      progress: 0.75,
      speedInfo: { loaded: 750_000, total: 1_000_000, rate: 204_800, bytes: 204_800 },
      abortObj: { abort: () => console.log('Abort Download') },
    }),
    createItem({ status: 'success', type: 'download', progress: 1 }),
    // Windows 对 .url / .dll 等文件名的限制
    createItem({
      status: 'failed',
      type: 'download',
      message: `TypeError: Failed to execute 'getFileHandle' on 'FileSystemDirectoryHandle': Name is not allowed.`,
      progress: 0.8,
    }),

    // ---- 文件名边界 ----
    createItem({
      filename: 'very_long_filename_to_test_ui_truncation_behavior_in_transfer_queue_list_item.png',
      status: 'transferring',
      progress: 0.15,
      speedInfo: { loaded: 150_000, total: 1_000_000, rate: 51_200, bytes: 51_200 },
      abortObj: { abort: () => console.log('Abort Upload') },
    }),
    createItem({ filename: '039.+Vexento+-+Borealis.mp3', status: 'success', progress: 1 }),
    createItem({ filename: '中文 名称 带空格 和 emoji 🎵.flac', status: 'transferring', type: 'download', progress: 0.5, abortObj: { abort: () => {} } }),
    createItem({ filename: '.hidden-dotfile', status: 'success', progress: 1 }),
    createItem({ filename: 'README', status: 'pending' }),
    createItem({ filename: '', path: 'D:/TEST/', status: 'failed', message: 'Empty name', progress: 0 }),

    // ---- 大小边界：0 字节 / 极大文件（检查字节格式化） ----
    createItem({ filename: 'empty.txt', size: 0, status: 'success', progress: 1 }),
    createItem({
      filename: 'archive.tar.zst',
      size: 1.6e12,
      status: 'transferring',
      progress: 0.02,
      speedInfo: { loaded: 32_000_000_000, total: 1_600_000_000_000, rate: 524_288_000, bytes: 524_288_000 },
      abortObj: { abort: () => {} },
    }),

    // ---- 失败信息很长（检查换行与溢出） ----
    createItem({
      status: 'failed',
      message: 'Error: EACCES: permission denied, open \'/mnt/data/some/deeply/nested/path/that/keeps/going/report-final-v2.pdf\'',
      progress: 0.62,
    }),
  ]

  // ---- 后台任务（复制 / 移动 / 删除）的每一种状态 ----
  replaceDebugTasks([
    debugServerTask('queued', {
      progress: { itemsTotal: 320, itemsDone: 0, bytesTotal: 0, bytesDone: 0 },
    }),
    debugServerTask('scanning', {
      state: 'scanning',
      progress: { itemsTotal: 12_480, itemsDone: 0, bytesTotal: 0, bytesDone: 0 },
    }),
    debugServerTask('conflict', {
      state: 'awaiting-conflict',
      progress: { itemsTotal: 5, itemsDone: 0, bytesTotal: 0, bytesDone: 0 },
      stats: { succeeded: 0, skipped: 0, renamed: 0, failed: 0, conflict: 3 },
    }),
    debugServerTask('running-copy', {
      progress: {
        itemsTotal: 120,
        itemsDone: 37,
        bytesTotal: 812_345_678,
        bytesDone: 229_102_233,
        currentPath: '/mock/source/holiday/big-video.mkv',
      },
    }),
    debugServerTask('running-move', {
      kind: 'move',
      isMove: true,
      toPath: '/mock/elsewhere/',
      progress: { itemsTotal: 42, itemsDone: 11, bytesTotal: 4_294_967_296, bytesDone: 1_073_741_824 },
    }),
    // 删除没有字节总量，只能按条数显示进度
    debugServerTask('running-delete', {
      kind: 'delete',
      toPath: '',
      fromPaths: ['/mock/junk'],
      progress: { itemsTotal: 48_213, itemsDone: 1_204, bytesTotal: 0, bytesDone: 0 },
    }),
    debugServerTask('succeeded', {
      state: 'succeeded',
      toPath: '',
      canCancel: false,
      progress: { itemsTotal: 9, itemsDone: 9, bytesTotal: 104_857_600, bytesDone: 104_857_600 },
      stats: { succeeded: 9, skipped: 0, renamed: 0, failed: 0, conflict: 0 },
    }),
    // 部分成功：有失败项，行上会出现「查看失败」按钮
    debugServerTask('partial', {
      state: 'partial',
      canCancel: false,
      progress: { itemsTotal: 4, itemsDone: 4, bytesTotal: 2_097_152, bytesDone: 2_097_152 },
      stats: { succeeded: 2, skipped: 1, renamed: 0, failed: 1, conflict: 1 },
      results: debugFailureResults,
    }),
    debugServerTask('failed', {
      state: 'failed',
      canCancel: false,
      toPath: '/mock/read-only/',
      error: 'permission denied',
      progress: { itemsTotal: 1, itemsDone: 1, bytesTotal: 1_048_576, bytesDone: 0 },
      stats: { succeeded: 0, skipped: 0, renamed: 0, failed: 1, conflict: 0 },
      results: [debugFailureResults[0]!],
    }),
    debugServerTask('cancelled', {
      state: 'cancelled',
      canCancel: false,
      progress: { itemsTotal: 120, itemsDone: 41, bytesTotal: 812_345_678, bytesDone: 240_123_456 },
      stats: { succeeded: 40, skipped: 0, renamed: 1, failed: 0, conflict: 0 },
    }),
    debugServerTask('duplicate', {
      kind: 'duplicate',
      state: 'succeeded',
      canCancel: false,
      toPath: '/mock/source/',
      progress: { itemsTotal: 1, itemsDone: 1, bytesTotal: 4096, bytesDone: 4096 },
      stats: { succeeded: 1, skipped: 0, renamed: 1, failed: 0, conflict: 0 },
    }),
    // 超长目标路径（检查标题溢出）
    debugServerTask('long-path', {
      toPath: '/mock/target/a/very/long/nested/destination/path/that/should/be/truncated/when/it/does/not/fit/in/the/row/',
      progress: { itemsTotal: 2_048, itemsDone: 1_536, bytesTotal: 8_589_934_592, bytesDone: 6_442_450_944 },
    }),
  ])
  recomputeTotals()
  triggerRef(listData)
}

function exitDebugMode() {
  debugMode.value = false
  removeDebugTasks()
}

// 菜单里的「Debug Transfer Window」
useExplorerBusOn(ExplorerEvents.DEBUG_TRANSFER, () => {
  loadMockTransferList()
})

defineExpose({
  addTask,
  addTasks,
  toggle,
  isVisible,
  totalCount,
  activeCount,
  failedCount,
})
</script>

<template>
  <TransferPanel
    v-model:active-tab="activeTab"
    :visible="isVisible"
    :summary="summary"
    :transfers="transferCounts"
    :tasks="taskCounts"
    @hide="isVisible = false"
  >
    <template #transfers>
      <TransferList
        v-show="activeTab === 'transfers'"
        :items="listData"
        @cancel="cancelItem"
        @retry="handleRetry"
        @manual-download="handleManualDownload"
      />
    </template>

    <template #tasks>
      <ServerTaskList
        v-show="activeTab === 'tasks'"
        :tasks="serverTasks"
        @cancel="cancelTask"
        @resolve="openConflictDialog"
        @failures="openFailureDialog"
        @dismiss="dismissTask"
      />
    </template>

    <template #footer>
      <!-- 两个页签的操作分开：上面那些按钮从来只管客户端传输，混在一起会让人以为它们也管后台任务 -->
      <template v-if="activeTab === 'transfers'">
        <div class="transfer-panel-actions">
          <button
            v-if="listData.length"
            class="vgo-button vgo-button--text vgo-button--sm"
            :title="`Concurrent: ${concurrentNum}, Transferring: ${transferringNum}`"
            @click="setConcurrentNum"
          >
            <i-mdi-compare-vertical /> {{ transferringNum }}
          </button>
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
        <button
          v-if="pendingNum > 0 || transferringNum > 0"
          class="vgo-button vgo-button--danger vgo-button--sm"
          @click="cancelTransfers"
        >
          Cancel All
        </button>
      </template>

      <template v-else>
        <div class="transfer-panel-actions">
          <button
            v-if="serverTasks.length"
            class="vgo-button vgo-button--sm"
            @click="clearFinishedServerTasks"
          >
            Clear finished
          </button>
        </div>
        <button
          v-if="hasServerActive"
          class="vgo-button vgo-button--danger vgo-button--sm"
          @click="cancelServerTasks"
        >
          Cancel All
        </button>
      </template>
    </template>
  </TransferPanel>
</template>

<style scoped lang="scss">
.transfer-panel-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--vgo-space-2);
  font-size: var(--vgo-font-md);
}
</style>
