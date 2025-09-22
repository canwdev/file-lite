<script setup lang="ts">
import ViewPortWindow from '@canwdev/vgo-ui/src/components/ViewPortWindow/index.vue'
import {TaskItem, TaskQueue} from '@/utils/task-queue'
import {fsWebApi} from '@/api/filesystem'
import {bytesToSize} from '@/utils'
import {isDev} from '@/enum'
import {useStorage} from '@vueuse/core'

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
  file: File
  // 绝对路径
  path: string
  filename?: string
}

interface IUploadItem extends IBatchFile {
  // 上传任务的序号
  index: number
  // 上传进度(0-1)
  progress: number
  // 上传状态
  status: 'success' | 'failed' | 'pending' | 'transferring'
  // 上传失败时的错误信息
  message: string
  // 上传过程中的abort对象
  abortObj?: {abort: () => void}
  // 上传成功后返回的结果
  result?: any
  speedInfo?: {
    loaded: number
    total: number
    rate: number
    bytes: number
  }
}

const listData = ref<IUploadItem[]>([])
const isVisible = ref(false)
const uploadIndex = ref(0)

watch(isVisible, (val) => {
  if (!val) {
    uploadIndex.value = 0
    cancelAll()
    listData.value = []
  }
})

const cancelAll = () => {
  taskQueueRef.value.removeAllTask()
  listData.value.forEach((i) => {
    if (i.status === 'pending' || i.status === 'transferring' || i.abortObj) {
      i.abortObj?.abort()
      i.status = 'failed'
      i.message = 'Cancelled'
    }
  })
}

const taskHandler = (task: TaskItem) => {
  const {data} = task
  // console.log('--- taskHandler', task, data)
  return new Promise(async (resolve, reject) => {
    try {
      const {path, file} = data

      const abortController = new AbortController()
      data.status = 'transferring'
      data.abortObj = {
        abort: async () => {
          abortController.abort()
          // 由于后端无法获得取消事件，并且存在文件残留，需要手动删除
          await fsWebApi.deleteEntry({path})
        },
      }
      data.message = `Uploading`

      await fsWebApi.uploadFile(
        {
          path,
          file,
        },
        {
          onUploadProgress(event) {
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
      data.status = 'success'
      data.abortObj = undefined
      data.message = 'Success'
      emit('singleDone', data)
      resolve(data)
    } catch (e: any) {
      console.error(e)
      data.status = 'failed'
      data.message = e.message
      data.abortObj = undefined
      reject(e)
    }
  })
}

const taskQueueRef = ref()
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
      const hasError = listData.value.some((i) => i.status === 'failed')
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

const addTask = (data: IBatchFile, position: number = -1) => {
  data = {
    ...data,
    index: ++uploadIndex.value,
    progress: 0,
    status: 'pending',
    message: 'Waiting',
  } as IUploadItem
  if (position !== -1) {
    listData.value.splice(position, 0, data as IUploadItem)
  } else {
    listData.value.push(data as IUploadItem)
  }
  taskQueueRef.value.addTask(data)
  isVisible.value = true
}
const addTasks = (data: IBatchFile[]) => {
  data.forEach((i) => {
    addTask(i)
  })
}

const handleRetry = (item: IUploadItem, index: number) => {
  listData.value.splice(index, 1)
  addTask(item, index)
}

// onMounted(() => {
//   if (isDev) {
//     const mockList = () => {
//       isVisible.value = true
//       listData.value = [
//         {
//           index: 1,
//           path: 'D:/TEST/test1_long_long_long_long_long_long.png',
//           filename: 'test1_long_long_long_long_long_long.png',
//           file: new File([], 'test1.png'),
//           progress: 0.5,
//           status: 'transferring',
//           message: 'Uploading',
//           abortObj: {
//             abort: () => {
//               console.log('abort')
//             },
//           },
//           speedInfo: {
//             loaded: 1000000,
//             total: 2000000,
//             rate: 1000000,
//             bytes: 1000000,
//           },
//         },
//         {
//           index: 2,
//           path: 'D:/TEST/test1.png',
//           filename: 'test1.png',
//           file: new File([], 'test1.png'),
//           progress: 1,
//           status: 'success',
//           message: '',
//         },
//         {
//           index: 3,
//           path: 'D:/TEST/test2.png',
//           filename: 'test2.png',
//           file: new File([], 'test1.png'),
//           progress: 0.6,
//           status: 'failed',
//           message: 'Test: Failed',
//         },
//         {
//           index: 4,
//           path: 'D:/TEST/test1_long_long_long_long_long_long.png',
//           filename: 'test1_long_long_long_long_long_long.png',
//           file: new File([], 'test2.png'),
//           progress: 0,
//           status: 'pending',
//           message: 'Waiting',
//         },
//       ]
//     }
//     mockList()
//   }
// })

const successNum = computed(() => {
  return listData.value.filter((i) => i.status === 'success').length
})
const transferringNum = computed(() => {
  return listData.value.filter((i) => i.status === 'transferring').length
})
const errorNum = computed(() => {
  return listData.value.filter((i) => i.status === 'failed').length
})
const totalProgress = computed(() => {
  return (successNum.value / listData.value.length) * 100
})
const clearFailed = () => {
  listData.value = listData.value.filter((i) => i.status !== 'failed')
}
const clearSuccess = () => {
  listData.value = listData.value.filter((i) => i.status !== 'success')
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
      <span v-if="listData.length"
        >{{ parseFloat(((successNum / listData.length) * 100).toFixed(2)) }}%</span
      >
      <span v-if="transferringNum">| Uploading {{ transferringNum }} </span>
      <span v-if="errorNum">| Failed {{ errorNum }} </span>
    </template>

    <div class="batch-upload-wrapper">
      <div class="total-progress volume-bar">
        <div :style="{width: totalProgress + '%'}" class="volume-value"></div>
      </div>

      <div class="upload-list">
        <div
          v-for="(item, index) in listData"
          :class="{failed: item.status === 'failed'}"
          :key="item.index"
          class="upload-item"
        >
          <div class="index-text">#{{ item.index }}</div>
          <div class="upload-status" :title="item.message">
            <template v-if="item.status === 'success'">
              <span class="mdi mdi-check-bold" style="color: #4caf50" title="成功"></span>
            </template>
            <template v-else-if="item.status === 'failed'">
              <span class="mdi mdi-alert" style="color: #f44336" title="失败"></span>
            </template>
            <template v-else-if="item.status === 'transferring'">
              <span
                class="mdi mdi-upload-circle-outline"
                style="color: #03a9f4"
                title="Uploading"
              ></span>
            </template>
            <template v-else-if="item.status === 'pending'">
              <span class="mdi mdi-progress-upload" style="color: #ffc107" title="Waiting"></span>
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
              <button class="vgo-button" v-if="item.abortObj" @click="item.abortObj.abort()">
                Cancel
              </button>
              <button
                class="vgo-button"
                v-if="item.status === 'failed'"
                @click="handleRetry(item, index)"
              >
                Retry
              </button>
            </div>

            <div class="volume-bar">
              <div :style="{width: item.progress * 100 + '%'}" class="volume-value"></div>
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
          <button v-if="errorNum > 0" class="vgo-button" @click="clearFailed">Clear Failed</button>
          <button v-if="successNum > 0" class="vgo-button" @click="clearSuccess">
            Clear Success
          </button>
        </div>
        <div class="flex-row-center-gap">
          <button v-if="taskQueueRef?.executing?.length" class="vgo-button" @click="cancelAll">
            Cancel All
          </button>
          <button v-else class="vgo-button primary" @click="isVisible = false">Close</button>
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
