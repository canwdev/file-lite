<script lang="ts" setup>
import type { IEntry } from '@/types/server.ts'
import { useElementVisibility } from '@vueuse/core'
import { fsWebApi } from '@/api/filesystem.ts'
import { PREVIEW_SIZE_UNLIMITED, settingsStore } from '@/store/index.ts'
import { regSupportedImageFormat } from '@/utils/is.ts'
import { requestPreviewLoad } from './preview-load-queue'

const props = withDefaults(
  defineProps<{
    iconClass: string
    item?: IEntry
    absPath?: string
    iconSize?: number
  }>(),
  {
    iconSize: 48,
  },
)

const PREVIEW_LOAD_DEBOUNCE_MS = 100

const loadFailed = ref(false)
watch(
  () => props.absPath,
  () => {
    loadFailed.value = false
  },
)
const previewSrc = computed(() => {
  const { item, absPath } = props
  const previewSize = settingsStore.value.previewSize
  if (absPath && item) {
    // 仅支持图片预览，且大小不超过配置上限
    if (
      previewSize !== 0
      && !item.isDirectory
      && regSupportedImageFormat.test(item.name)
      && (previewSize === PREVIEW_SIZE_UNLIMITED || Number(item.size) <= previewSize)
    ) {
      return fsWebApi.getStreamUrl(absPath)
    }
  }
  return ''
})

// 仅当元素可见时才加载预览图片
const target = useTemplateRef<HTMLDivElement>('target')
// const targetIsVisible = useElementVisibility(target as never, {
//   rootMargin: '500px 0px 500px 0px',
// })
const targetIsVisible = ref(true)

const queuedPreviewSrc = ref('')
let stopPreviewLoad: (() => void) | null = null
let previewLoadDebounceTimer: ReturnType<typeof setTimeout> | null = null

function stopCurrentPreviewLoad() {
  stopPreviewLoad?.()
  stopPreviewLoad = null
  queuedPreviewSrc.value = ''
}

function schedulePreviewLoad(src: string) {
  if (previewLoadDebounceTimer)
    clearTimeout(previewLoadDebounceTimer)

  previewLoadDebounceTimer = setTimeout(() => {
    previewLoadDebounceTimer = null
    stopCurrentPreviewLoad()

    if (!src)
      return

    stopPreviewLoad = requestPreviewLoad(() => {
      queuedPreviewSrc.value = src
    })
  }, PREVIEW_LOAD_DEBOUNCE_MS)
}

function finishCurrentPreviewLoad() {
  stopPreviewLoad?.()
  stopPreviewLoad = null
}

watch(
  [previewSrc, targetIsVisible, loadFailed],
  ([src, isVisible, failed]) => {
    schedulePreviewLoad(src && isVisible && !failed ? src : '')
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (previewLoadDebounceTimer)
    clearTimeout(previewLoadDebounceTimer)
  stopCurrentPreviewLoad()
})
</script>

<template>
  <div ref="target" class="themed-icon" :style="{ width: `${iconSize}px` }">
    <img
      v-if="queuedPreviewSrc"
      class="preview-image"
      :src="queuedPreviewSrc"
      @load="finishCurrentPreviewLoad"
      @error="() => {
        loadFailed = true
        finishCurrentPreviewLoad()
      }"
    >
    <span
      v-else-if="iconClass"
      class="themed-icon-class"
      :class="[iconClass]"
      :style="{ fontSize: `${iconSize}px` }"
    />
    <span v-else class="themed-icon-class mdi mdi-file-question" />
  </div>
</template>

<style lang="scss" scoped>
.themed-icon {
  display: inline-flex;
  align-content: center;
  justify-content: center;
  position: relative;
  width: 48px;
  aspect-ratio: 1;
  flex-shrink: 0;

  .preview-image {
    width: 100%;
    aspect-ratio: 1;
    object-fit: contain;
    //outline: 1px solid var(--vgo-primary);
  }

  .themed-icon-class {
    line-height: 1;
    color: var(--vgo-primary);
    &.abs-icon {
      position: absolute;
      right: 0;
      bottom: 0;
      font-size: 16px !important;
    }
  }
}
</style>
