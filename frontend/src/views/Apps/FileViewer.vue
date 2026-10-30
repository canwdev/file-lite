<script lang="ts" setup>
import { ThemeMode } from '@/hooks/use-global-theme'
import { useFileLiteSdk } from '@/sdk/use-app-sdk'
import { localSettingsStore } from '@/store'
import dynamicLoadScript from '@/utils/dynamic-load-script'

const sdk = useFileLiteSdk()

// Pinned on purpose: this third-party IIFE is injected into the authenticated
// origin, so `@latest` would let any upstream publish (or a CDN compromise) run
// arbitrary JavaScript in the session. Bump the version deliberately when the
// viewer needs an update. Loading it with an SRI hash would harden this further;
// that needs crossOrigin="anonymous" (unpkg serves the CORS headers) and the
// hash of the exact artifact.
const FILE_VIEWER_SCRIPT_VERSION = '3.2.1'
const FILE_VIEWER_SCRIPT_URL = `https://unpkg.com/@file-viewer/web-full@${FILE_VIEWER_SCRIPT_VERSION}/dist/flyfish-file-viewer-web-full.iife.js`

const path = ref('')
const filename = ref('')

/** 文件地址。跟随当前打开的文件变化。 */
const src = computed(() => path.value ? sdk.url(path.value) : '')
const isLoading = ref(true)
const error = ref('')

const viewerTheme = computed(() => {
  const mode = localSettingsStore.value.themeMode
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
    error.value = $t('file_lite_i18n.failed')
  }
  finally {
    isLoading.value = false
  }
}

sdk.onOpen((launch) => {
  if (!launch) {
    path.value = ''
    filename.value = ''
    return
  }
  path.value = launch.path
  filename.value = launch.filename
  sdk.setTitle(launch.filename)
})

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
