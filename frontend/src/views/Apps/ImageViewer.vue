<script lang="ts" setup="">
import type { SdkEntry } from '@/sdk/contract'
import { useFileLiteSdk } from '@/sdk/use-app-sdk'
import { regSupportedImageFormat } from '@/utils/is.ts'

const props = withDefaults(
  defineProps<{
    /** 是否使用原生图片查看器 */
    isNative?: boolean
  }>(),
  {
    isNative: false,
  },
)

const sdk = useFileLiteSdk()
const initialIndex = ref(0)
const filteredList = ref<SdkEntry[]>([])
const viewerKey = ref(0)

/** 当前这批图片的绝对路径。 */
const imagePaths = computed(() => filteredList.value.map(item => item.path))

/** 图片地址，按路径取；换一批图（切换目录、再次打开）时自动跟随。 */
const urlMap = computed(() => new Map(imagePaths.value.map(path => [path, sdk.url(path)])))
const urlList = computed(() => imagePaths.value.map(path => urlMap.value.get(path) ?? ''))

sdk.onOpen(async (launch) => {
  filteredList.value = []
  initialIndex.value = 0
  if (!launch) {
    return
  }
  const current = await sdk.getLaunch()
  const entries = current?.entries ?? []
  filteredList.value = entries.filter((entry) => {
    return (regSupportedImageFormat.test(entry.name) && !entry.isDirectory) || entry.name === launch.filename
  })
  initialIndex.value = Math.max(0, filteredList.value.findIndex(entry => entry.path === launch.path))
  viewerKey.value += 1
})

watch(initialIndex, (val) => {
  sdk.setTitle(filteredList.value[val]?.name || '')
}, { immediate: true })
</script>

<template>
  <div class="image-viewer">
    <img v-if="props.isNative" :src="urlList[initialIndex]" class="image-viewer-native-image">
    <el-image-viewer
      v-else
      :key="viewerKey"
      :url-list="urlList"
      show-progress
      :initial-index="initialIndex"
      :hide-on-click-modal="false"
      @close="sdk.exit()"
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
