<script setup lang="ts">
import type { VgoOptionItem } from '@canwdev/vgo-ui'
import type { AppParams } from '@/views/Apps/apps'
import { OptionUI, VgoOptionType } from '@canwdev/vgo-ui'
import {
  ElCheckbox,
  ElColorPicker,
  ElDatePicker,
  ElInput,
  ElInputNumber,
  ElOption,
  ElSelect,
  ElSpace,
  ElSwitch,
  ElTooltip,
} from 'element-plus'
import { applyUpdate, exitBackend, restartBackend } from '@/api/server'
import { isDev } from '@/enum'
import { ThemeMode } from '@/hooks/use-global-theme'
import { clearLastOpenedMediaMap } from '@/hooks/use-last-opened-media'
import { localSettingsStore, settingsStore } from '@/store'
import { serverCapabilities } from '@/store/capabilities'
import { enableDebug } from '@/utils/debug'
import { clearImageThumbCache, getImageThumbCacheStats } from '@/utils/image-thumb-cache'
import { InternalAppEnum } from '@/views/Apps/apps'
import { appWindows } from '@/views/Apps/apps-store'
import { useCollection } from '@/views/Apps/EndlessGallery/use-collection'
import ThemeSwatches from '@/views/Apps/Settings/ThemeSwatches.vue'
import { explorerStateMap } from '@/views/FileManager/ExplorerUI/explorer-state'
import explorerBus, { ExplorerEvents } from '@/views/FileManager/utils/bus'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/space/style/css'
import 'element-plus/es/components/switch/style/css'

defineProps<{ appParams: AppParams }>()

defineEmits<{
  exit: []
  setTitle: [title: string]
}>()

// OptionUI resolves el-* at runtime. This app registers components on demand,
// so the rest of the UI can keep importing Element Plus per component.
const optionUiComponents = {
  ElSwitch,
  ElInput,
  ElOption,
  ElSelect,
  ElColorPicker,
  ElInputNumber,
  ElDatePicker,
  ElSpace,
  ElTooltip,
}

const app = getCurrentInstance()?.appContext.app
if (app) {
  for (const [name, component] of Object.entries(optionUiComponents)) {
    if (!app.component(name))
      app.component(name, component)
  }
}

const { clearCollection } = useCollection()

type CacheStats = Awaited<ReturnType<typeof getImageThumbCacheStats>>
const cacheStats = ref<CacheStats | null>(null)

const debugSettings = reactive({
  get enabled() {
    return enableDebug.value
  },
  set enabled(value: boolean) {
    enableDebug.value = value
  },
})

function formatCacheBytes(bytes: number) {
  if (bytes >= 1024 ** 3)
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2)
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024)
    return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

const imageCacheSubtitle = computed(() => {
  const stats = cacheStats.value
  if (!stats)
    return 'Checking…'
  if (!stats.available)
    return 'Unavailable in this browser'
  if (stats.entries === 0)
    return 'Empty'
  return `${stats.entries} items · ${formatCacheBytes(stats.bytes)}`
})

const imageCacheDisabled = computed(() => !cacheStats.value?.available || cacheStats.value.entries === 0)

async function refreshCacheStats() {
  cacheStats.value = await getImageThumbCacheStats()
}

watch(() => appWindows.activeId, (id) => {
  const win = id ? appWindows.get(id) : undefined
  if (win?.data.appName === InternalAppEnum.Settings)
    void refreshCacheStats()
}, { immediate: true })

function trimPageTitle() {
  settingsStore.value.pageTitle = settingsStore.value.pageTitle.trim()
}

/**
 * Pick a backend binary to upload. On success, wait a second for the process
 * to restart, then reload. Failures are already toasted by the service interceptor.
 */
function handleUpdateBackend() {
  const input = document.createElement('input')
  input.type = 'file'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file)
      return
    applyUpdate(file)
      .then((res) => {
        window.$message?.success(`Updated to v${res.to}, restarting…`)
        setTimeout(() => window.location.reload(), 1000)
      })
      .catch(() => {
        // The service interceptor already toasted the reason.
      })
  }
  input.click()
}

/** Restart the backend process so it reloads config. In-flight transfers are cut off. */
async function handleRestartBackend() {
  try {
    await window.$dialog.confirm(
      'Restart the backend process?',
      'Restart Backend',
      {
        type: 'warning',
        confirmButtonText: 'Restart',
        cancelButtonText: 'Cancel',
      },
    )
  }
  catch {
    return
  }

  try {
    await restartBackend()
  }
  catch {
    return
  }

  window.$message?.success('Restarting…')
  setTimeout(() => window.location.reload(), 1000)
}

/**
 * Exit the backend process. The browser cannot close an ordinary tab, so a
 * dialog explains that the process has stopped.
 */
async function handleExitBackend() {
  try {
    await window.$dialog.confirm(
      'Exit the backend process? It may need to be started again manually on the server.',
      'Exit Backend',
      {
        type: 'warning',
        confirmButtonText: 'Exit',
        cancelButtonText: 'Cancel',
      },
    )
  }
  catch {
    return
  }

  try {
    await exitBackend()
  }
  catch {
    return
  }

  // The process exits after the response is sent.
  setTimeout(() => {
    void window.$dialog.alert('Backend exited', 'Exit Backend', { type: 'info' }).catch(() => {
      // Dialog dismissed.
    })
  }, 600)
}

async function clearImageCache() {
  const stats = cacheStats.value ?? await getImageThumbCacheStats()
  if (!stats.available) {
    window.$message.warning('Image cache is unavailable in this browser')
    return
  }
  if (stats.entries === 0)
    return
  try {
    await window.$dialog.confirm(
      `<div>This will clear ${stats.entries} cached image thumbnails (${formatCacheBytes(stats.bytes)}).</div>`,
      'Clear Image Cache',
      {
        type: 'warning',
        confirmButtonText: 'Clear',
        cancelButtonText: 'Cancel',
        dangerouslyUseHTMLString: true,
      },
    )
    await clearImageThumbCache()
    window.$message.success('Image cache cleared')
    await refreshCacheStats()
  }
  catch {
    // cancelled
  }
}

async function clearLocalData() {
  const stats = cacheStats.value ?? await getImageThumbCacheStats()
  const cacheLabel = `Image preview cache${stats.entries > 0 ? ` (${stats.entries} items · ${formatCacheBytes(stats.bytes)})` : ''}`

  const selected = reactive({
    media: true,
    collection: true,
    folderState: true,
    imageCache: true,
  })
  const choices: { key: keyof typeof selected, label: string }[] = [
    { key: 'media', label: 'Last opened media per folder' },
    { key: 'collection', label: 'Collected items (Endless Gallery)' },
    { key: 'folderState', label: 'Folder state (scroll position & sort mode)' },
    { key: 'imageCache', label: cacheLabel },
  ]

  const message = () => h('div', { style: 'display: flex; flex-direction: column; gap: var(--vgo-space-2);' }, choices.map(option => h(ElCheckbox, {
    'modelValue': selected[option.key],
    'onUpdate:modelValue': (value: string | number | boolean) => {
      selected[option.key] = Boolean(value)
    },
  }, () => option.label)))

  try {
    await window.$dialog.confirm(message, 'Clear Local Data', {
      confirmButtonText: 'Clear',
      cancelButtonText: 'Cancel',
    })
  }
  catch {
    return
  }

  if (selected.media)
    clearLastOpenedMediaMap()
  if (selected.collection)
    clearCollection()
  if (selected.folderState)
    explorerStateMap.value = {}
  if (selected.imageCache)
    void clearImageThumbCache().then(() => refreshCacheStats())

  if (choices.some(option => selected[option.key]))
    window.$message.success('Local data cleared')
}

function present(items: Array<VgoOptionItem | false>): VgoOptionItem[] {
  return items.filter((item): item is VgoOptionItem => Boolean(item))
}

const local = computed(() => localSettingsStore.value)

const options = computed<VgoOptionItem[]>(() => [
  {
    label: 'Appearance',
    key: 'appearance',
    children: [
      {
        label: 'Theme',
        key: 'themeMode',
        type: VgoOptionType.MULTIPLE_SWITCH,
        options: [
          { label: 'Auto', value: ThemeMode.Auto },
          { label: 'Light', value: ThemeMode.Light },
          { label: 'Dark', value: ThemeMode.Dark },
        ],
      },
      {
        label: 'Color',
        key: 'colorTheme',
        cls: 'settings-color-row',
        render: () => h(ThemeSwatches),
      },
      {
        label: 'Reduce motion',
        key: 'reduceMotion',
        type: VgoOptionType.SWITCH,
        store: local.value,
        subtitle: 'Shortens animations and drops blur.',
      },
    ],
  },
  {
    label: 'Apps',
    key: 'apps',
    children: [
      {
        label: 'Use native video player',
        key: 'isNativePlayer',
        type: VgoOptionType.SWITCH,
        store: local.value,
      },
      {
        label: 'Single app instance',
        key: 'appSingleInstance',
        type: VgoOptionType.SWITCH,
        store: local.value,
        subtitle: 'Opening an app again focuses the window that is already open.',
      },
      {
        label: 'Remember last opened media',
        key: 'rememberLastMedia',
        type: VgoOptionType.SWITCH,
        subtitle: 'Media Player resumes the last file in each folder. Turning this off clears that memory.',
      },
      {
        label: 'Open apps with the filtered list',
        key: 'openAppWithFilteredList',
        type: VgoOptionType.SWITCH,
        store: local.value,
      },
      {
        label: 'Show folders first',
        key: 'sortFoldersFirst',
        type: VgoOptionType.SWITCH,
        store: local.value,
      },
    ],
  },
  {
    label: 'Page',
    key: 'page',
    children: [
      {
        label: 'Title',
        key: 'pageTitle',
        type: VgoOptionType.INPUT,
        subtitle: 'Shown in the top bar and the browser tab. Leave empty for the default title.',
        props: {
          placeholder: 'Custom title',
          onBlur: trimPageTitle,
        },
      },
    ],
  },
  {
    label: 'Preview',
    key: 'preview',
    children: [
      {
        label: 'Disable preview',
        key: 'disablePreview',
        type: VgoOptionType.SWITCH,
        store: local.value,
        subtitle: 'Hides thumbnails and covers.',
      },
      {
        label: 'Image cache',
        key: 'imageCache',
        subtitle: imageCacheSubtitle.value,
        type: VgoOptionType.BUTTON,
        value: 'Clear',
        disabled: imageCacheDisabled.value,
        props: {

          onClick: () => {
            void clearImageCache()
          },
        },
      },
      {
        label: 'Local data',
        key: 'localData',
        subtitle: 'Last opened media, gallery collection, folder view state, and the image cache.',
        type: VgoOptionType.BUTTON,
        value: 'Clear…',
        props: {

          onClick: () => {
            void clearLocalData()
          },
        },
      },
    ],
  },
  {
    label: 'Development',
    key: 'development',
    children: present([
      {
        label: 'Debug console',
        key: 'enabled',
        type: VgoOptionType.SWITCH,
        store: debugSettings,
      },
      isDev && {
        label: 'Demo transfer window',
        key: 'demoTransfer',
        type: VgoOptionType.BUTTON,
        value: 'Open',
        props: {

          onClick: () => {
            explorerBus.emit(ExplorerEvents.DEBUG_TRANSFER)
          },
        },
      },
      serverCapabilities.value.selfUpdate && {
        label: 'Backend binary',
        key: 'updateBackend',
        subtitle: 'Replace the running server binary and restart.',
        type: VgoOptionType.BUTTON,
        value: 'Update…',
        props: {

          onClick: handleUpdateBackend,
        },
      },
      serverCapabilities.value.selfUpdate && {
        label: 'Restart backend',
        key: 'restartBackend',
        subtitle: 'Reloads config. Transfers in progress are interrupted.',
        type: VgoOptionType.BUTTON,
        value: 'Restart…',
        props: {

          onClick: () => {
            void handleRestartBackend()
          },
        },
      },
      serverCapabilities.value.selfUpdate && {
        label: 'Exit backend',
        key: 'exitBackend',
        type: VgoOptionType.BUTTON,
        value: 'Exit…',
        props: {
          class: 'vgo-button--sm vgo-button--danger',
          onClick: () => {
            void handleExitBackend()
          },
        },
      },
    ]),
  },
])

function onOptionUpdate(payload: { item: VgoOptionItem, value: unknown }) {
  if (payload.item.key === 'rememberLastMedia' && payload.value === false)
    clearLastOpenedMediaMap()
}
</script>

<template>
  <div class="settings">
    <OptionUI
      expand-id="file-lite-settings"
      :option-list="options"
      :store="settingsStore"
      @update-value="onOptionUpdate"
    />
  </div>
</template>

<style scoped lang="scss">
.settings {
  height: 100%;
  overflow: auto;
  background-color: var(--vgo-surface);
}

.settings :deep(.settings-color-row) {
  align-items: flex-start;
}

.settings :deep(.vgo-option-item__child) {
  flex-wrap: wrap;
}
</style>
