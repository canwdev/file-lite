<script lang="ts" setup>
import type { AppParams } from '@/views/Apps/apps.ts'
import { useFileUrl } from '@/hooks/use-file-url'

const props = defineProps<{
  appParams: AppParams
}>()

const emit = defineEmits(['setTitle'])

/** 挂载卷里的文件没有服务端地址，解析层会给一个 objectURL */
const src = useFileUrl(() => props.appParams?.absPath)

watch(() => props.appParams, () => {
  const { appParams } = props
  if (!appParams?.absPath) {
    return
  }
  emit('setTitle', appParams.item.name)
}, { immediate: true })
</script>

<template>
  <div class="html-viewer">
    <iframe
      v-if="src"
      class="html-viewer__frame"
      referrerpolicy="no-referrer"
      :src="src"
    />
  </div>
</template>

<style lang="scss" scoped>
.html-viewer {
  width: 100%;
  height: 100%;

  &__frame {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
}
</style>
