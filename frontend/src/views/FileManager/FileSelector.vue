<script lang="ts" setup="">
import type { FileSelectResult } from '@/views/FileManager/types'
import { ViewPortWindow } from '@canwdev/vgo-ui'
import { onKeyStroke } from '@vueuse/core'
import FileManager from '@/views/FileManager/FileManager.vue'

const props = withDefaults(
  defineProps<{
    // 是否文件(夹)选择器
    selectFileMode?: 'file' | 'folder'
    // 文件选择器允许多选
    multiple?: boolean
    showButton?: boolean
    autoShow?: boolean
    // 文件后缀过滤正则，如 "\\.(mp4|webm|mkv)$"，仅对 selectFileMode='file' 有效
    fileFilterPattern?: string
    // 窗口标题；缺省用动作名（Open File... / Open Folder...）
    title?: string
    // 窗口初始尺寸
    width?: string
    height?: string
    // 传入后记忆窗口位置与大小
    wid?: string
  }>(),
  {
    selectFileMode: 'file',
    showButton: false,
    multiple: false,
    autoShow: false,
    title: '',
    width: '500px',
    height: '500px',
  },
)
const emit = defineEmits<{
  handleSelect: [item: FileSelectResult]
  close: []
  open: []
}>()
const { selectFileMode, multiple, autoShow, fileFilterPattern, title, width, height, wid } = toRefs(props)

const isShowFileSelectWindow = ref(false)
// 第一次打开后才挂载 FileManager，之后保持挂载：窗口再开关不会重建列表 / 重拉驱动器
const hasMounted = ref(false)

function handleSelect(item: FileSelectResult) {
  isShowFileSelectWindow.value = false
  emit('handleSelect', item)
}

const actionLabel = computed(() => {
  return selectFileMode.value === 'file'
    ? multiple.value
      ? 'Open Files...'
      : 'Open File...'
    : 'Open Folder...'
})

const windowTitle = computed(() => title.value || actionLabel.value)

onMounted(() => {
  if (autoShow.value) {
    isShowFileSelectWindow.value = true
  }
})

watch(isShowFileSelectWindow, (newVal) => {
  if (newVal) {
    hasMounted.value = true
    emit('open')
  }
  else {
    emit('close')
  }
})

// Esc 关闭窗口（焦点在窗口内任意位置都生效）
onKeyStroke('Escape', (event) => {
  if (!isShowFileSelectWindow.value || event.defaultPrevented) {
    return
  }
  isShowFileSelectWindow.value = false
})

defineExpose({
  isShowFileSelectWindow,
  show() {
    isShowFileSelectWindow.value = true
  },
  close() {
    isShowFileSelectWindow.value = false
  },
})
</script>

<template>
  <div class="file-selector">
    <button v-if="showButton" class="vgo-button vgo-button--primary" @click="isShowFileSelectWindow = true">
      {{ actionLabel }}
    </button>

    <ViewPortWindow
      v-model:visible="isShowFileSelectWindow"
      :wid="wid"
      init-center
      :init-win-options="{ width, height }"
    >
      <template #titleBarLeft>
        {{ windowTitle }}
      </template>
      <FileManager
        v-if="hasMounted" :select-file-mode="selectFileMode" :multiple="multiple"
        :file-filter-pattern="fileFilterPattern"
        shortcut-scope="fileSelector"
        @cancel-select="isShowFileSelectWindow = false" @handle-select="handleSelect"
      />
    </ViewPortWindow>
  </div>
</template>

<style lang="scss" scoped>
.file-selector {
}
</style>
