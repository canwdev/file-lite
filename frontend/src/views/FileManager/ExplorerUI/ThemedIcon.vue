<script lang="ts" setup>
import type { IEntry } from '@server/types/server.ts'
import { useElementVisibility } from '@vueuse/core'
import { fsWebApi } from '@/api/filesystem.ts'
import { regSupportedImageFormat } from '@/utils/is.ts'

const props = withDefaults(defineProps<{
  iconClass: string
  item?: IEntry
  absPath?: string
  iconSize?: number
}>(), {
  iconSize: 48,
})

const loadFailed = ref(false)
watch(() => props.absPath, () => {
  loadFailed.value = false
})
const previewSrc = computed(() => {
  const { item, absPath } = props
  if (absPath && item) {
    // 仅支持图片预览，且大小不超过 30MB
    if (!item.isDirectory && regSupportedImageFormat.test(item.name) && Number(item.size) < (30 * 1024 * 1024)) {
      return fsWebApi.getStreamUrl(absPath)
    }
  }
  return ''
})

// 仅当元素可见时才加载预览图片
const target = useTemplateRef<HTMLDivElement>('target')
const targetIsVisible = useElementVisibility(target, {
  rootMargin: '0px 0px 100px 0px',
})
</script>

<template>
  <div ref="target" class="themed-icon" :style="{ width: `${iconSize}px` }">
    <img v-if="!loadFailed && previewSrc && targetIsVisible" class="preview-image" :src="previewSrc" @error="loadFailed = true">
    <span v-else-if="iconClass" class="themed-icon-class" :class="[iconClass]" :style="{ fontSize: `${iconSize}px` }" />
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
