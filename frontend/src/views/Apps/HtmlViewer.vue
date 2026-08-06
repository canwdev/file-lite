<script lang="ts" setup>
import type { AppParams } from '@/views/Apps/apps.ts'
import { fsWebApi } from '@/api/filesystem'
import { bytesToSize } from '@/utils'

const props = defineProps<{
  appParams: AppParams
}>()

const emit = defineEmits(['setTitle'])

const SIZE_LIMIT = 100 * 1024 * 1024

const html = ref('')
const isLoading = ref(false)
const error = ref('')

async function loadFile() {
  html.value = ''
  error.value = ''

  const { appParams } = props
  if (!appParams?.absPath) {
    return
  }

  const { item, absPath } = appParams
  emit('setTitle', item.name)

  if (item.size != null && item.size > SIZE_LIMIT) {
    error.value = `File is too large (${bytesToSize(item.size)})`
    return
  }

  try {
    isLoading.value = true
    html.value = await fsWebApi.stream(absPath, { responseType: 'text' }) as unknown as string
  }
  catch (err) {
    console.error('[HtmlViewer] load failed', err)
    error.value = 'Failed to load file'
  }
  finally {
    isLoading.value = false
  }
}

watch(() => props.appParams, loadFile, { immediate: true })
</script>

<template>
  <div class="html-viewer">
    <div v-if="isLoading" class="html-viewer__status">
      Loading...
    </div>
    <div v-else-if="error" class="html-viewer__status">
      {{ error }}
    </div>
    <iframe
      v-else
      class="html-viewer__frame"
      sandbox=""
      referrerpolicy="no-referrer"
      :srcdoc="html"
    />
  </div>
</template>

<style lang="scss" scoped>
.html-viewer {
  width: 100%;
  height: 100%;
  // vgo-allow: 外部 HTML 自带样式，容器底色固定为白
  background-color: #fff;

  &__status {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--vgo-text-secondary);
  }

  &__frame {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
}
</style>
