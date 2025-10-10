<script lang="ts" setup="">
import type { IEntry } from '@server/types/server.ts'
import type { AppParams } from '@/views/Apps/apps.ts'
import { fsWebApi } from '@/api/filesystem.ts'
import { regSupportedImageFormat } from '@/utils/is.ts'

const props = withDefaults(
  defineProps<{
    appParams: AppParams
  }>(),
  {},
)
const emit = defineEmits(['setTitle', 'exit'])
// const { appParams } = toRefs(props)
// const mediaSrc = computed(() => {
//   return fsWebApi.getStreamUrl(appParams.value?.absPath)
// })

const initialIndex = ref(0)
const urlList = ref<string[]>([])
const filteredList = ref<IEntry[]>([])
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
    initialIndex.value = filteredList.value.findIndex(i => i.name === item.name)
  },
  { immediate: true },
)

watch(initialIndex, (val) => {
  emit('setTitle', filteredList.value[val].name || '')
}, { immediate: true })
</script>

<template>
  <div class="image-viewer">
    <!-- <img :src="mediaSrc"> -->
    <el-image-viewer
      :url-list="urlList"
      show-progress
      :initial-index="initialIndex"
      :hide-on-click-modal="true"
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

  //img {
  //  width: 100%;
  //  height: 100%;
  //  object-fit: contain;
  //}

  :deep(.el-image-viewer__mask) {
    background: #212121;
    background-image:
      linear-gradient(45deg, black 25%, transparent 25%, transparent 75%, black 75%, black),
      linear-gradient(45deg, black 25%, transparent 25%, transparent 75%, black 75%, black);
    background-size: 60px 60px;
    background-position:
      0 0,
      30px 30px;
    opacity: 0.8;
  }
  :deep(.el-image-viewer__wrapper) {
    position: absolute !important;
  }
  :deep(.el-image-viewer__close) {
    display: none;
  }
}
</style>
