<script setup lang="ts">
import type { TaskItem } from '@/utils/task-queue'
import ViewPortWindow from '@canwdev/vgo-ui/src/components/ViewPortWindow/ViewPortWindow.vue'
import { useStorage } from '@vueuse/core'
import { fsWebApi } from '@/api/filesystem'
import { isDev } from '@/enum'
import { authToken } from '@/store'
import { bytesToSize, downloadUrl } from '@/utils'
import { TaskQueue } from '@/utils/task-queue'

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
  // 下载时使用的父级目录句柄
  parentHandle?: FileSystemDirectoryHandle
  type?: 'upload' | 'download'
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

const listData = ref<ITransferItem[]>([])
const isVisible = ref(false)
const transferIndex = ref(0)
const taskQueueRef = ref()

watch(isVisible, (val) => {
  if (!val) {
    transferIndex.value = 0
    cancelAll()
    listData.value = []
  }
})

function cancelAll() {
  taskQueueRef.value.removeAllTask()
  listData.value.forEach((i) => {
    if (i.status === 'pending' || i.status === 'transferring' || i.abortObj) {
      i.abortObj?.abort()
      i.status = 'failed'
      i.message = 'Cancelled'
    }
  })
}

async function handleUpload(data: ITransferItem, abortController: AbortController) {
  const { path, file } = data
  if (!file) {
    throw new Error('File is required for upload')
  }
  await fsWebApi.uploadFile(
    {
      path,
      file,
    },
    {
      onUploadProgress(event: any) {
        // console.log(event)
        data.progress = event.progress
        data.speedInfo = {
          loaded: event.loaded,
          total: event.total,
          rate: event.rate,
          bytes: event.bytes,
        }
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

  // 文件下载逻辑
  const response = await fetch(fsWebApi.getStreamUrl(path), {
    headers: {
      Authorization: authToken.value,
    },
    signal: abortController.signal,
  })

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('Response body is not readable')
  }

  const contentLength = Number.parseInt(response.headers.get('Content-Length') || '0')
  const fileHandle = await parentHandle.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()

  let loaded = 0
  let lastTime = Date.now()
  let lastLoaded = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break

      await writable.write(value)
      loaded += value.length

      // Update progress and speed
      const currentTime = Date.now()
      const timeDiff = (currentTime - lastTime) / 1000 // seconds
      if (timeDiff >= 0.5 || loaded === contentLength) {
        data.progress = contentLength ? loaded / contentLength : 0
        const bytesDiff = loaded - lastLoaded
        const rate = timeDiff > 0 ? bytesDiff / timeDiff : 0

        data.speedInfo = {
          loaded,
          total: contentLength,
          rate,
          bytes: bytesDiff,
        }

        lastTime = currentTime
        lastLoaded = loaded
      }
    }
  }
  finally {
    await writable.close()
    reader.releaseLock()
  }
}

function taskHandler(task: TaskItem) {
  const { data } = task as { data: ITransferItem }
  // console.log('--- taskHandler', task, data)
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    try {
      const { path, type = 'upload' } = data

      const abortController = new AbortController()
      data.status = 'transferring'
      data.abortObj = {
        abort: async () => {
          abortController.abort()
          if (type === 'upload') {
            // 由于后端无法获得取消事件，并且存在文件残留，需要手动删除
            await fsWebApi.deleteEntry({ path: [path] })
          }
        },
      }
      data.message = type === 'upload' ? 'Uploading' : 'Downloading'

      if (type === 'upload') {
        await handleUpload(data, abortController)
      }
      else {
        await handleDownload(data, abortController)
      }

      data.status = 'success'
      data.abortObj = undefined
      data.message = 'Success'
      emit('singleDone', data)
      resolve(data)
    }
    catch (e: any) {
      if (e.name === 'AbortError') {
        return
      }
      console.error(e)
      data.status = 'failed'
      data.message = e.message
      data.abortObj = undefined
      reject(e)
    }
  })
}

const concurrentNum = useStorage('file_lite_concurrent_num', 1, localStorage, {
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
      const hasError = listData.value.some(i => i.status === 'failed')
      if (!hasError) {
        isVisible.value = false
      }
    }
  })
})
onBeforeUnmount(() => {
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
  } as ITransferItem
  if (position !== -1) {
    listData.value.splice(position, 0, data as ITransferItem)
  }
  else {
    listData.value.push(data as ITransferItem)
  }
  taskQueueRef.value.addTask(data)
  isVisible.value = true
}
function addTasks(data: IBatchFile[]) {
  data.forEach((i) => {
    addTask(i)
  })
}

function handleRetry(item: ITransferItem, index: number) {
  listData.value.splice(index, 1)
  addTask(item, index)
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
  }
  mockList()
})

const successNum = computed(() => {
  return listData.value.filter(i => i.status === 'success').length
})
const transferringNum = computed(() => {
  return listData.value.filter(i => i.status === 'transferring').length
})
const errorNum = computed(() => {
  return listData.value.filter(i => i.status === 'failed').length
})
const totalProgress = computed(() => {
  return (successNum.value / listData.value.length) * 100
})
function clearFailed() {
  listData.value = listData.value.filter(i => i.status !== 'failed')
}
function clearSuccess() {
  listData.value = listData.value.filter(i => i.status !== 'success')
}

function setConcurrentNum() {
  const num = prompt('Enter the number of concurrent tasks', String(concurrentNum.value) || '1')
  const intNum = Number.parseInt(num || '0')
  if (num && !Number.isNaN(intNum) && intNum > 0) {
    concurrentNum.value = intNum
    taskQueueRef.value.concurrent = intNum
  }
}
defineExpose({
  addTask,
  addTasks,
})
</script>

<template>
  <ViewPortWindow
    v-model:visible="isVisible"
    :show-close="!taskQueueRef?.executing?.length"
    :init-win-options="{
      width: '360px',
    }"
    wid="file_lite_upload_dialog"
  >
    <template #titleBarLeft>
      <span class="mdi mdi-cloud-sync" />
      <span>[{{ successNum }}/{{ listData.length }}]</span>
      <span v-if="listData.length">{{ parseFloat(((successNum / listData.length) * 100).toFixed(2)) }}%</span>

      <span v-if="errorNum" title="Failed"> <span class="mdi mdi-alert-circle" style="color: #f44336" /> {{ errorNum }} </span>
    </template>

    <div class="transfer-wrapper">
      <div class="total-progress-bar">
        <div :style="{ width: `${totalProgress}%` }" class="bar-value" />
      </div>

      <div class="transfer-list">
        <div
          v-for="(item, index) in listData"
          :key="item.index"
          :class="[item.status, item.type]"
          class="transfer-item"
        >
          <div class="item-main">
            <div class="item-status-icon">
              <template v-if="item.status === 'success'">
                <span class="mdi mdi-check-circle" style="color: #4caf50" />
              </template>
              <template v-else-if="item.status === 'failed'">
                <span class="mdi mdi-alert-circle" style="color: #f44336" />
              </template>
              <template v-else-if="item.status === 'transferring'">
                <span
                  class="mdi mdi-loading mdi-spin"
                  style="color: #03a9f4"
                />
              </template>
              <template v-else>
                <span
                  class="mdi"
                  :class="item.type === 'download' ? 'mdi-download-outline' : 'mdi-upload-outline'"
                  style="color: #9e9e9e"
                />
              </template>
            </div>

            <div class="item-content">
              <div class="item-info">
                <div class="item-title" :title="item.path">
                  <span class="type-icon">
                    <i class="mdi" :class="item.type === 'download' ? 'mdi-download' : 'mdi-upload'" />
                  </span>
                  <span class="filename">{{ item.filename || item.path }}</span>
                </div>
                <div class="item-meta">
                  <template v-if="item.status === 'transferring' && item.speedInfo">
                    <span class="speed">{{ bytesToSize(item.speedInfo.rate) }}/s</span>
                    <span class="size">{{ bytesToSize(item.speedInfo.loaded) }} / {{ bytesToSize(item.speedInfo.total) }}</span>
                  </template>
                  <template v-else>
                    <span class="message" :title="item.message">{{ item.message }}</span>
                  </template>
                  <span class="percent">{{ (item.progress * 100).toFixed(0) }}%</span>
                </div>
              </div>
            </div>

            <div class="item-actions">
              <button
                v-if="item.abortObj"
                class="action-btn"
                title="Cancel"
                @click="item.abortObj.abort()"
              >
                <i class="mdi mdi-close" />
              </button>
              <button
                v-if="item.status === 'failed'"
                class="action-btn"
                title="Retry"
                @click="handleRetry(item, index)"
              >
                <i class="mdi mdi-refresh" />
              </button>
              <button
                v-if="item.status === 'failed' && item.type === 'download'"
                class="action-btn primary"
                title="Manual Download"
                @click="handleManualDownload(item)"
              >
                <i class="mdi mdi-download" />
              </button>
            </div>
          </div>

          <div class="item-progress">
            <div class="progress-bar">
              <div :style="{ width: `${item.progress * 100}%` }" class="progress-value" />
            </div>
          </div>
        </div>
      </div>
      <div class="transfer-footer">
        <div class="footer-group">
          <span
            v-if="transferringNum"
            class="cursor-pointer"
            :title="`Concurrent: ${concurrentNum}, Transferring: ${transferringNum}`"
            @click="setConcurrentNum"
          > <span class="mdi mdi-compare-vertical" /> {{ transferringNum }} </span>

          <button v-if="errorNum > 0" class="vgo-button" @click="clearFailed">
            Clear Failed
          </button>
          <button v-if="successNum > 0" class="vgo-button" @click="clearSuccess">
            Clear Success
          </button>
        </div>
        <div class="footer-group">
          <button v-if="taskQueueRef?.executing?.length" class="vgo-button danger" @click="cancelAll">
            Cancel All
          </button>
          <button v-else class="vgo-button primary" @click="isVisible = false">
            Close
          </button>
        </div>
      </div>
    </div>
  </ViewPortWindow>
</template>

<style scoped lang="scss">
.transfer-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: var(--vgo-color-bg);

  .total-progress-bar {
    height: 3px;
    background-color: var(--vgo-color-border);
    width: 100%;

    .bar-value {
      height: 100%;
      background-color: #4caf50;
      transition: width 0.3s ease;
    }
  }

  .transfer-list {
    height: 400px;
    overflow-y: auto;
    padding: 0;

    .transfer-item {
      display: flex;
      flex-direction: column;
      padding: 0;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
      transition: background-color 0.2s;

      &:hover {
        background-color: var(--vgo-color-hover);
      }

      .item-main {
        display: flex;
        align-items: center;
        padding: 8px 12px;
        gap: 12px;
        width: 100%;
        box-sizing: border-box;
      }

      .item-status-icon {
        font-size: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        flex-shrink: 0;
      }

      .item-content {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;

        .item-info {
          display: flex;
          flex-direction: column;
          gap: 2px;

          .item-title {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            font-weight: 500;
            color: var(--vgo-color-text);

            .type-icon {
              font-size: 14px;
              opacity: 0.6;
              display: flex;
            }

            .filename {
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
          }

          .item-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 11px;
            color: var(--vgo-color-text-secondary);
            opacity: 0.8;

            .message {
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              flex: 1;
              margin-right: 8px;
            }

            .speed, .size {
              margin-right: 8px;
              white-space: nowrap;
            }

            .percent {
              font-weight: 600;
            }
          }
        }
      }

      .item-progress {
        width: 100%;
        .progress-bar {
          height: 2px;
          background-color: transparent;
          overflow: hidden;

          .progress-value {
            height: 100%;
            background-color: #2196f3;
            transition: width 0.3s ease;
          }
        }
      }

      &.success .progress-value { background-color: #4caf50 !important; }
      &.failed .progress-value { background-color: #f44336 !important; }
      // &.transferring .progress-bar { background-color: rgba(0, 0, 0, 0.05); }

      .item-actions {
        display: flex;
        gap: 4px;

        .action-btn {
          border: none;
          background: transparent;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          color: var(--vgo-color-text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          transition: all 0.2s;
          line-height: 1;

          &:hover {
            background-color: rgba(0, 0, 0, 0.1);
            color: var(--vgo-color-text);
          }

          &.primary {
            color: #2196f3;
            &:hover {
              background-color: rgba(33, 150, 243, 0.1);
            }
          }
        }
      }
    }
  }

  .transfer-footer {
    padding: 10px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid var(--vgo-color-border);
    background-color: var(--vgo-color-bg-soft);

    .footer-group {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    }

    button {
      padding: 4px 12px;
      font-size: 12px;
      height: 28px;

      &.danger {
        color: #f44336;
        &:hover {
          background-color: rgba(244, 67, 54, 0.1);
        }
      }
    }
  }

}
</style>
