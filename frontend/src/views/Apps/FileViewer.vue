<script lang="ts" setup>
import type { AppParams } from '@/views/Apps/apps.ts'
import { fsWebApi } from '@/api/filesystem'
import { ThemeMode } from '@/hooks/use-global-theme'
import { settingsStore } from '@/store'
import dynamicLoadScript from '@/utils/dynamic-load-script'

const props = defineProps<{
  appParams: AppParams
}>()

const emit = defineEmits(['setTitle'])

const FILE_VIEWER_SCRIPT_URL = 'https://unpkg.com/@file-viewer/web-full@latest/dist/flyfish-file-viewer-web-full.iife.js'

const src = ref('')
const filename = ref('')
const isLoading = ref(true)
const error = ref('')

const viewerTheme = computed(() => {
  const mode = settingsStore.value.themeMode
  if (mode === ThemeMode.Light) {
    return 'light'
  }
  if (mode === ThemeMode.Dark) {
    return 'dark'
  }
  return 'system'
})

async function loadViewer() {
  try {
    await dynamicLoadScript(FILE_VIEWER_SCRIPT_URL)
  }
  catch (err) {
    console.error('[FileViewer] load viewer script failed', err)
    error.value = 'Failed to load viewer'
  }
  finally {
    isLoading.value = false
  }
}

watch(() => props.appParams, () => {
  const { appParams } = props
  if (!appParams?.absPath) {
    return
  }
  emit('setTitle', appParams.item.name)
  src.value = fsWebApi.getStreamUrl(appParams.absPath)
  filename.value = appParams.item.name
}, { immediate: true })

onMounted(loadViewer)
</script>

<template>
  <div class="file-viewer">
    <div v-if="isLoading" class="file-viewer__status">
      Loading flyfish-file-viewer from cdn...
    </div>
    <div v-else-if="error" class="file-viewer__status">
      {{ error }}
    </div>
    <flyfish-file-viewer
      v-else
      class="file-viewer__viewer"
      :src.attr="src"
      :filename.attr="filename"
      :theme="viewerTheme"
      locale="en-US"
      toolbar-position="bottom-right"
    />
  </div>
</template>

<style lang="scss" scoped>
.file-viewer {
  width: 100%;
  height: 100%;

  &__status {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--vgo-text-secondary);
  }

  &__viewer {
    display: block;
    width: 100%;
    height: 100%;
  }
}
</style>
