<script lang="ts" setup="">
import type { IEntry } from '@/types/server.ts'
import type { AppParams } from '@/views/Apps/apps.ts'
import { fsWebApi } from '@/api/filesystem.ts'
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
// const { appParams } = toRefs(props)
// const mediaSrc = computed(() => {
//   return fsWebApi.getStreamUrl(appParams.value?.absPath)
// })

const initialIndex = ref(0)
const urlList = ref<string[]>([])
const filteredList = ref<IEntry[]>([])
const viewerKey = ref(0)
// 应用启动传参
watch(
  () => props.appParams,
  () => {
    urlList.value = []
    filteredList.value = []
    initialIndex.value = 0
    if (!props.appParams) {
      return
    }
    const { item, list, basePath } = props.appParams
    filteredList.value = list
      .filter((i) => {
        return (regSupportedImageFormat.test(i.name) && !i.isDirectory) || i.name === item.name
      })

    urlList.value = filteredList.value.map(i => fsWebApi.getStreamUrl(`${basePath}/${i.name}`))
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
