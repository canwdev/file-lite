<script lang="ts" setup="">
import type { FileSelectResult } from '@/views/FileManager/types'
import { ViewPortWindow } from '@canwdev/vgo-ui'
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
  }>(),
  {
    selectFileMode: 'file',
    showButton: false,
    multiple: false,
    autoShow: false,
  },
)
const emit = defineEmits<{
  handleSelect: [item: FileSelectResult]
  close: []
  open: []
}>()
const { selectFileMode, multiple, autoShow, fileFilterPattern } = toRefs(props)

const isShowFileSelectWindow = ref(false)

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

onMounted(() => {
  if (autoShow.value) {
    isShowFileSelectWindow.value = true
  }
})

watch(isShowFileSelectWindow, (newVal) => {
  if (!newVal) {
    emit('close')
  }
  else {
    emit('open')
  }
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
      v-model:visible="isShowFileSelectWindow" init-center :init-win-options="{
        width: '500px',
        height: '500px',
      }"
    >
      <template #titleBarLeft>
        {{ actionLabel }}: {{ fileFilterPattern }}
      </template>
      <FileManager
        v-if="isShowFileSelectWindow" :select-file-mode="selectFileMode" :multiple="multiple"
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
