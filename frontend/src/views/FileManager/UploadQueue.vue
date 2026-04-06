<script setup lang="ts">
import type { TaskItem } from '@/utils/task-queue'
import ViewPortWindow from '@canwdev/vgo-ui/src/components/ViewPortWindow/ViewPortWindow.vue'
import { useStorage } from '@vueuse/core'
import { fsWebApi } from '@/api/filesystem'
import { authToken } from '@/store'
import { bytesToSize } from '@/utils'
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

interface IBatchFile {
  file?: File
  // 绝对路径
  path: string
  filename?: string
  // 下载时使用的父级目录句柄
  parentHandle?: FileSystemDirectoryHandle
  type?: 'upload' | 'download'
}

interface ITransferItem extends IBatchFile {
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

/* onMounted(() => {
  const mockList = () => {
    isVisible.value = true
    listData.value = [
      {
        index: 1,
        path: 'D:/TEST/test1_long_long_long_long_long_long.png',
        filename: 'test1_long_long_long_long_long_long.png',
        file: new File([], 'test1.png'),
        progress: 0.5,
        status: 'transferring',
        message: 'Uploading',
        abortObj: {
          abort: () => {
            console.log('abort')
          },
        },
        speedInfo: {
          loaded: 1000000,
          total: 2000000,
          rate: 1000000,
          bytes: 1000000,
        },
      },
      {
        index: 2,
        path: 'D:/TEST/test1.png',
        filename: 'test1.png',
        file: new File([], 'test1.png'),
        progress: 1,
        status: 'success',
        message: '',
      },
      {
        index: 3,
        path: 'D:/TEST/test2.png',
        filename: 'test2.png',
        file: new File([], 'test1.png'),
        progress: 0.6,
        status: 'failed',
        message: 'Test: Failed',
      },
      {
        index: 4,
        path: 'D:/TEST/test1_long_long_long_long_long_long.png',
        filename: 'test1_long_long_long_long_long_long.png',
        file: new File([], 'test2.png'),
        progress: 0,
        status: 'pending',
        message: 'Waiting',
      },
    ]
  }
  mockList()
}) */

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
      ({{ successNum }}/{{ listData.length }})
      <span v-if="listData.length">{{ parseFloat(((successNum / listData.length) * 100).toFixed(2)) }}%</span>
      <span v-if="transferringNum">| Transferring {{ transferringNum }} </span>
      <span v-if="errorNum">| Failed {{ errorNum }} </span>
    </template>

    <div class="batch-upload-wrapper">
      <div class="total-progress volume-bar">
        <div :style="{ width: `${totalProgress}%` }" class="volume-value" />
      </div>

      <div class="upload-list">
        <div
          v-for="(item, index) in listData"
          :key="item.index"
          :class="{ failed: item.status === 'failed' }"
          class="upload-item"
        >
          <div class="index-text">
            #{{ item.index }}
          </div>
          <div class="upload-status" :title="item.message">
            <template v-if="item.status === 'success'">
              <span class="mdi mdi-check-bold" style="color: #4caf50" title="Success" />
            </template>
            <template v-else-if="item.status === 'failed'">
              <span class="mdi mdi-alert" style="color: #f44336" title="Failed" />
            </template>
            <template v-else-if="item.status === 'transferring'">
              <span
                class="mdi"
                :class="item.type === 'download' ? 'mdi-download-circle-outline' : 'mdi-upload-circle-outline'"
                style="color: #03a9f4"
                :title="item.type === 'download' ? 'Downloading' : 'Uploading'"
              />
            </template>
            <template v-else-if="item.status === 'pending'">
              <span
                class="mdi"
                :class="item.type === 'download' ? 'mdi-progress-download' : 'mdi-progress-upload'"
                style="color: #ffc107"
                title="Waiting"
              />
            </template>
          </div>
          <div class="upload-content">
            <div class="upload-info-wrapper">
              <div class="flex-cols" style="flex: 1; gap: 4px; overflow: hidden">
                <div class="upload-title" :title="item.path">
                  <template v-if="item.filename">
                    {{ item.filename }}
                  </template>
                  <template v-else>
                    {{ item.path }}
                  </template>
                </div>
                <div class="upload-info">
                  <div class="progress-text">
                    <template v-if="item.progress > 0">
                      <span>{{ (item.progress * 100).toFixed(0) }}%</span>
                    </template>
                  </div>
                  <div class="message-text text-overflow" :title="item.message">
                    {{ item.message }}
                  </div>
                </div>
              </div>
              <button v-if="item.abortObj" class="vgo-button" @click="item.abortObj.abort()">
                Cancel
              </button>
              <button
                v-if="item.status === 'failed'"
                class="vgo-button"
                @click="handleRetry(item, index)"
              >
                Retry
              </button>
            </div>

            <div class="volume-bar">
              <div :style="{ width: `${item.progress * 100}%` }" class="volume-value" />
            </div>

            <div
              v-if="item.speedInfo && item.status === 'transferring'"
              class="speed-info-wrapper flex-row-center-gap"
            >
              <div>
                {{ bytesToSize(item.speedInfo.loaded) }}/{{ bytesToSize(item.speedInfo.total) }}
              </div>
              <div>{{ bytesToSize(item.speedInfo.rate) }}/s</div>
            </div>
          </div>
        </div>
      </div>
      <div class="upload-control">
        <div class="flex-row-center-gap">
          <button v-if="errorNum > 0" class="vgo-button" @click="clearFailed">
            Clear Failed
          </button>
          <button v-if="successNum > 0" class="vgo-button" @click="clearSuccess">
            Clear Success
          </button>
        </div>
        <div class="flex-row-center-gap">
          <button v-if="taskQueueRef?.executing?.length" class="vgo-button" @click="cancelAll">
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
.batch-upload-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;

  button {
    font-size: 12px;
    height: fit-content;
    flex-shrink: 0;
  }

  .upload-control {
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border-top: var(--vgo-color-border);
  }

  .upload-list {
    height: 400px;
    overflow-x: hidden;
    overflow-y: auto;
    box-sizing: border-box;

    .upload-item {
      padding: 10px;
      display: flex;
      gap: 8px;
      align-items: center;
      position: relative;

      .index-text {
        position: absolute;
        top: 4px;
        left: 4px;
        font-size: 12px;
      }

      &:nth-child(even) {
        background-color: rgba(0, 0, 0, 0.03);
      }

      &:hover {
        background-color: var(--vgo-color-hover);
      }

      .upload-status {
        font-size: 28px;
      }

      .upload-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
        overflow: hidden;

        .upload-info-wrapper {
          display: flex;
          flex-wrap: nowrap;
          gap: 8px;
          align-items: flex-start;
          justify-content: space-between;
        }
      }

      .upload-title {
        font-size: 12px;
        font-weight: 500;
        line-height: 1.2;
        word-break: break-word;
      }

      .upload-info {
        font-size: 12px;
        display: flex;
        justify-content: space-between;
        gap: 8px;

        & > div {
          overflow: hidden;
        }

        .progress-text {
          font-weight: bold;
        }

        .message-text {
          flex: 1;
          text-align: right;
          opacity: 0.5;
        }
      }

      .speed-info-wrapper {
        justify-content: space-between;
        font-size: 12px;
        opacity: 0.5;
      }

      .volume-bar {
        border-radius: 100px;
      }

      &.failed {
        .volume-bar {
          .volume-value {
            background-color: #f44336;
          }
        }
      }
    }
  }

  .volume-bar {
    overflow: hidden;
    height: 4px;
    width: 100%;
    position: relative;
    background-color: #d6d6d6;

    .volume-value {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 0;
      background-color: #4caf50;
      transition: all 0.3s;
    }
  }

  .total-progress {
    width: 100%;
    flex-shrink: 0;
  }
}
</style>
