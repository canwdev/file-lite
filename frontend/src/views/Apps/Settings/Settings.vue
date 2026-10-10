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
import { localeOptions } from '@/i18n'
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
      'Restart backend',
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
      'Exit backend',
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
    void window.$dialog.alert('Backend exited', 'Exit backend', { type: 'info' }).catch(() => {
      // Dialog dismissed.
    })
  }, 600)
}

async function clearLocalData() {
  const stats = cacheStats.value ?? await getImageThumbCacheStats()
  const cacheLabel = $t('file_lite_i18n.image_preview_cache_0', [stats.entries > 0 ? `(${stats.entries} ${$t('file_lite_i18n.items')} · ${formatCacheBytes(stats.bytes)})` : ''])

  const selected = reactive({
    media: false,
    collection: false,
    folderState: false,
    imageCache: false,
  })
  const choices: { key: keyof typeof selected, label: string }[] = [
    { key: 'media', label: $t('file_lite_i18n.last_opened_media_per_folder') },
    { key: 'collection', label: $t('file_lite_i18n.collected_items_endless_gallery') },
    { key: 'folderState', label: `${$t('file_lite_i18n.folder_state')} (scroll position & sort mode)` },
    { key: 'imageCache', label: cacheLabel },
  ]

  const message = () => h('div', { style: 'display: flex; flex-direction: column; gap: var(--vgo-space-2);' }, choices.map(option => h(ElCheckbox, {
    'modelValue': selected[option.key],
    'onUpdate:modelValue': (value: string | number | boolean) => {
      selected[option.key] = Boolean(value)
    },
  }, () => option.label)))

  try {
    await window.$dialog.confirm(message, $t('file_lite_i18n.clear_local_data'), {
      confirmButtonText: $t('file_lite_i18n.clear'),
      cancelButtonText: $t('file_lite_i18n.cancel'),
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
    window.$message.success($t('file_lite_i18n.local_data_cleared'))
}

function present(items: Array<VgoOptionItem | false>): VgoOptionItem[] {
  return items.filter((item): item is VgoOptionItem => Boolean(item))
}

const local = computed(() => localSettingsStore.value)

const options = computed<VgoOptionItem[]>(() => [
  {
    label: $t('file_lite_i18n.appearance'),
    key: 'appearance',
    children: [
      {
        label: $t('file_lite_i18n.theme'),
        key: 'themeMode',
        type: VgoOptionType.MULTIPLE_SWITCH,
        options: [
          { label: $t('file_lite_i18n.auto'), value: ThemeMode.Auto },
          { label: $t('file_lite_i18n.light'), value: ThemeMode.Light },
          { label: $t('file_lite_i18n.dark'), value: ThemeMode.Dark },
        ],
      },
      {
        label: $t('file_lite_i18n.color'),
        key: 'colorTheme',
        cls: 'settings-color-row',
        render: () => h(ThemeSwatches),
      },
      {
        label: $t('file_lite_i18n.language'),
        key: 'language',
        type: VgoOptionType.SELECT,
        options: localeOptions.map(option => ({ label: option.label, value: option.value })),
      },
      {
        label: $t('file_lite_i18n.reduce_motion'),
        key: 'reduceMotion',
        type: VgoOptionType.SWITCH,
        store: local.value,
        subtitle: $t('file_lite_i18n.shortens_animations_and_drops_bl'),
      },
      {
        label: $t('file_lite_i18n.custom_title'),
        key: 'pageTitle',
        type: VgoOptionType.INPUT,
        subtitle: $t('file_lite_i18n.shown_in_the_top_bar_and_the_bro'),
        props: {
          placeholder: $t('file_lite_i18n.custom_title'),
          onBlur: trimPageTitle,
        },
      },
    ],
  },
  {
    label: $t('file_lite_i18n.apps'),
    key: 'apps',
    children: [
      {
        label: $t('file_lite_i18n.native_video_player'),
        key: 'isNativePlayer',
        type: VgoOptionType.SWITCH,
        store: local.value,
        subtitle: $t('file_lite_i18n.uses_the_html5_video_player_inst'),
      },
      {
        label: $t('file_lite_i18n.remember_last_opened_media'),
        key: 'rememberLastMedia',
        type: VgoOptionType.SWITCH,
        subtitle: $t('file_lite_i18n.media_player_shows_a_resume_butt'),
      },
      {
        label: $t('file_lite_i18n.open_apps_with_the_filtered_list'),
        key: 'openAppWithFilteredList',
        type: VgoOptionType.SWITCH,
        store: local.value,
        subtitle: $t('file_lite_i18n.apps_will_use_filtered_list_item'),
      },
      {
        label: $t('file_lite_i18n.show_folders_first'),
        key: 'sortFoldersFirst',
        type: VgoOptionType.SWITCH,
        store: local.value,
      },
    ],
  },
  {
    label: $t('file_lite_i18n.local_data'),
    key: 'data',
    children: [
      {
        label: $t('file_lite_i18n.disable_preview'),
        key: 'disablePreview',
        type: VgoOptionType.SWITCH,
        store: local.value,
        subtitle: $t('file_lite_i18n.hides_thumbnails_and_covers'),
      },
      {
        label: $t('file_lite_i18n.local_data'),
        key: 'localData',
        subtitle: $t('file_lite_i18n.last_opened_media_gallery_collec'),
        type: VgoOptionType.BUTTON,
        value: $t('file_lite_i18n.clear') + ELLIPSIS,
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
        value: 'Upload…',
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
          class: 'vgo-button--danger',
          onClick: () => {
            void handleExitBackend()
          },
        },
      },
    ]),
  },
])
</script>

<template>
  <div class="settings">
    <OptionUI
      expand-id="file-lite-settings"
      :option-list="options"
      :store="settingsStore"
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
