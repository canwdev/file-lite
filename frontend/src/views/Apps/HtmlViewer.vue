<script lang="ts" setup>
import type { AppParams } from '@/views/Apps/apps.ts'
import { fsWebApi } from '@/api/filesystem'

const props = defineProps<{
  appParams: AppParams
}>()

const emit = defineEmits(['setTitle'])

const src = ref('')

watch(() => props.appParams, () => {
  const { appParams } = props
  if (!appParams?.absPath) {
    return
  }

  const { item, absPath } = appParams
  emit('setTitle', item.name)

  src.value = fsWebApi.getStreamUrl(absPath)
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
