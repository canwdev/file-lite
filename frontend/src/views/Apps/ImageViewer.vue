<script lang="ts" setup="">
import type { IEntry } from '@/types/server.ts'
import type { AppParams } from '@/views/Apps/apps.ts'
import { useFileUrls } from '@/hooks/use-file-url'
import { regSupportedImageFormat } from '@/utils/is.ts'

const props = withDefaults(
  defineProps<{
    appParams: AppParams
    /** 是否使用原生图片查看器 */
    isNative?: boolean
  }>(),
  {
    isNative: false,
  },
)
const emit = defineEmits(['setTitle', 'exit'])

const initialIndex = ref(0)
const filteredList = ref<IEntry[]>([])
const viewerKey = ref(0)

/** 当前这批图片的绝对路径（列表总是来自同一个 basePath）。 */
const imagePaths = computed(() => {
  const base = (props.appParams?.basePath ?? '').replace(/\/+$/, '')
  return filteredList.value.map(item => `${base}/${item.name}`)
})

/**
 * 图片地址，按路径取；换一批图（切换目录、切换应用参数）时自动跟随。
 */
const urlMap = useFileUrls(() => imagePaths.value)
const urlList = computed(() => {
  return imagePaths.value.map(path => urlMap.value.get(path) ?? '')
})

// 应用启动传参
watch(
  () => props.appParams,
  () => {
    filteredList.value = []
    initialIndex.value = 0
    if (!props.appParams) {
      return
    }
    const { item, list } = props.appParams
    filteredList.value = list
      .filter((i) => {
        return (regSupportedImageFormat.test(i.name) && !i.isDirectory) || i.name === item.name
      })

    initialIndex.value = Math.max(0, filteredList.value.findIndex(i => i.name === item.name))
    viewerKey.value += 1
  },
  { immediate: true },
)

watch(initialIndex, (val) => {
  emit('setTitle', filteredList.value[val]?.name || '')
}, { immediate: true })
</script>

<template>
  <div class="image-viewer">
    <img v-if="isNative" :src="urlList[initialIndex]" class="image-viewer-native-image">
    <el-image-viewer
      v-else
      :key="viewerKey"
      :url-list="urlList"
      show-progress
      :initial-index="initialIndex"
      :hide-on-click-modal="false"
      @close="emit('exit')"
      @switch="index => initialIndex = index"
    />
  </div>
</template>

<style lang="scss" scoped>
.image-viewer {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  z-index: 1;

  .image-viewer-native-image {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  // vgo-allow: 看图遮罩固定为深色，与主题无关
  :deep(.el-image-viewer__mask) {
    background-color: #212121;
    opacity: 0.9;
  }
  :deep(.el-image-viewer__wrapper) {
    position: absolute !important;
  }
  :deep(.el-image-viewer__close) {
    display: none;
  }
}
</style>
