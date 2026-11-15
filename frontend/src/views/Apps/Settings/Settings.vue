<script setup lang="ts">
import type { VgoOptionItem } from '@canwdev/vgo-ui'
import { OptionUI, VgoOptionType } from '@canwdev/vgo-ui'
import dayjs from 'dayjs'
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
import MdiCalendarSync from '~icons/mdi/calendar-sync'
import MdiDatabaseOutline from '~icons/mdi/database-outline'
import MdiEyeOutline from '~icons/mdi/eye-outline'
import MdiFilterVariant from '~icons/mdi/filter-variant'
import MdiFormatTitle from '~icons/mdi/format-title'
import MdiHistory from '~icons/mdi/history'
import MdiImageOffOutline from '~icons/mdi/image-off-outline'
import MdiLayersOutline from '~icons/mdi/layers-outline'
import MdiPaletteOutline from '~icons/mdi/palette-outline'
import MdiPlayBoxOutline from '~icons/mdi/play-box-outline'
import MdiSourceBranch from '~icons/mdi/source-branch'
import MdiTagOutline from '~icons/mdi/tag-outline'
import MdiThemeLightDark from '~icons/mdi/theme-light-dark'
import MdiTranslate from '~icons/mdi/translate'
import MdiUpdate from '~icons/mdi/update'
import MdiWallpaper from '~icons/mdi/wallpaper'
import { applyUpdate, exitBackend, restartBackend } from '@/api/server'
import { isDev } from '@/enum'
import { PKG_NAME, VERSION } from '@/enum/version'
import { ThemeMode } from '@/hooks/use-global-theme'
import { clearLastOpenedMediaMap } from '@/hooks/use-last-opened-media'
import { localeOptions } from '@/i18n'
import { localSettingsStore, settingsStore } from '@/store'
import { serverCapabilities } from '@/store/capabilities'
import { updateBusy, updateChecking, updateInfo } from '@/store/update'
import { WALLPAPER_PRESETS } from '@/themes/translucent/presets'
import { CUSTOM_URL_CHOICE, useWallpaperSettings } from '@/themes/translucent/use-wallpaper-settings'
import { enableDebug } from '@/utils/debug'
import { clearImageThumbCache, getImageThumbCacheStats } from '@/utils/image-thumb-cache'
import { InternalAppEnum } from '@/views/Apps/apps'
import { appWindows } from '@/views/Apps/apps-store'
import { useCollection } from '@/views/Apps/EndlessGallery/use-collection'
import { builtinAppOf } from '@/views/Apps/registry'
import ColorThemeSelect from '@/views/Apps/Settings/ColorThemeSelect.vue'
import UpdateChecker from '@/views/Apps/Settings/UpdateChecker.vue'
import { explorerStateMap } from '@/views/FileManager/ExplorerUI/explorer-state'
import explorerBus, { ExplorerEvents } from '@/views/FileManager/utils/bus'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/space/style/css'
import 'element-plus/es/components/switch/style/css'

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

/** Background rows: the mode select plus the rows it reveals (see the hook). */
const wallpaper = useWallpaperSettings()

// A row without an icon still needs its icon box: OptionUI only renders the
// fixed-width slot when `iconRender` is set, and without it the label slides to
// the left edge instead of lining up with the rows above and below.
const noRowIcon = () => h('span')

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
  if (win && builtinAppOf(win.data.target) === InternalAppEnum.Settings)
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
    { key: 'collection', label: $t('file_lite_i18n.collected_items_endless_gallery', [$t('file_lite_i18n.endless_gallery')]) },
    { key: 'folderState', label: $t('file_lite_i18n.folder_state') },
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

/** 发布构建带 -pre 后缀；源码构建只有基础版本号。 */
const displayVersion = computed(() => {
  const tag = serverCapabilities.value.buildTag
  if (!tag)
    return `v${VERSION}`
  return tag.startsWith('v') ? tag : `v${tag}`
})

const versionSubtitle = computed(() => {
  const platform = serverCapabilities.value.platform ? ` (${serverCapabilities.value.platform})` : ''
  return `<a href="https://github.com/canwdev/file-lite" target="_blank" rel="noopener noreferrer">${PKG_NAME}</a> ${displayVersion.value}${platform}`
})

const updateStatusText = computed(() => {
  if (updateBusy.value)
    return `${$t('file_lite_i18n.updating')}${ELLIPSIS}`
  if (updateChecking.value)
    return `${$t('file_lite_i18n.checking')}${ELLIPSIS}`
  const info = updateInfo.value
  if (info?.available) {
    return info.tag === settingsStore.value.updateSkippedVersion
      ? $t('file_lite_i18n.skipped_version_0', [info.latest])
      : $t('file_lite_i18n.update_available_0', [info.latest])
  }
  if (info)
    return $t('file_lite_i18n.on_latest_version')
  const last = settingsStore.value.updateLastCheckAt
  if (last > 0)
    return $t('file_lite_i18n.last_checked_0', [dayjs(last).format('YYYY-MM-DD HH:mm')])
  return $t('file_lite_i18n.not_checked_yet')
})

const options = computed<VgoOptionItem[]>(() => [
  {
    label: $t('file_lite_i18n.appearance'),
    key: 'appearance',
    children: present([
      {
        label: $t('file_lite_i18n.appearance'),
        key: 'themeMode',
        iconRender: () => h(MdiThemeLightDark),
        store: local.value,
        type: VgoOptionType.MULTIPLE_SWITCH,
        options: [
          { label: $t('file_lite_i18n.auto'), value: ThemeMode.Auto },
          { label: $t('file_lite_i18n.light'), value: ThemeMode.Light },
          { label: $t('file_lite_i18n.dark'), value: ThemeMode.Dark },
        ],
      },
      {
        label: $t('file_lite_i18n.theme'),
        key: 'themeStyle',
        iconRender: () => h(MdiLayersOutline),
        store: local.value,
        type: VgoOptionType.SELECT,
        options: [
          { label: $t('file_lite_i18n.default'), value: 'default' },
          { label: $t('file_lite_i18n.translucent'), value: 'translucent' },
        ],
      },
      local.value.themeStyle === 'translucent' && {
        label: $t('file_lite_i18n.background'),
        key: 'mode',
        iconRender: () => h(MdiWallpaper),
        subtitle: wallpaper.sourceText.value,
        store: wallpaper.modeStore,
        type: VgoOptionType.SELECT,
        options: [
          { label: $t('file_lite_i18n.none'), value: 'none' },
          { label: $t('file_lite_i18n.url'), value: 'url' },
          { label: $t('file_lite_i18n.local_image'), value: 'local' },
        ],
      },
      local.value.themeStyle === 'translucent' && wallpaper.showPresetRow.value && {
        label: $t('file_lite_i18n.preset'),
        key: 'choice',
        iconRender: noRowIcon,
        store: wallpaper.urlChoiceStore,
        type: VgoOptionType.SELECT,
        options: [
          ...WALLPAPER_PRESETS.map(preset => ({ label: preset.label, value: preset.id })),
          { label: $t('file_lite_i18n.custom'), value: CUSTOM_URL_CHOICE },
        ],
      },
      local.value.themeStyle === 'translucent' && wallpaper.showUrlRow.value && {
        label: $t('file_lite_i18n.image_url'),
        key: 'url',
        iconRender: noRowIcon,
        store: wallpaper.urlDraft,
        type: VgoOptionType.INPUT,
        props: { placeholder: 'https://…' },
        actionRender: () => h('button', {
          class: 'vgo-button',
          onClick: () => wallpaper.applyUrl(),
        }, $t('file_lite_i18n.apply')),
      },
      local.value.themeStyle === 'translucent' && wallpaper.showLocalRow.value && {
        label: $t('file_lite_i18n.local_image'),
        key: 'localImage',
        iconRender: noRowIcon,
        actionRender: () => h('div', { class: 'settings-row-actions' }, [
          h('button', {
            class: 'vgo-button',
            disabled: wallpaper.busy.value,
            onClick: () => void wallpaper.upload(),
          }, wallpaper.uploadLabel.value),
          h('button', {
            class: 'vgo-button',
            onClick: () => wallpaper.clear(),
          }, $t('file_lite_i18n.clear')),
        ]),
      },
      {
        label: $t('file_lite_i18n.color'),
        key: 'colorTheme',
        iconRender: () => h(MdiPaletteOutline),
        actionRender: () => h(ColorThemeSelect),
      },
      {
        label: `${$t('file_lite_i18n.language')} / Language`,
        key: 'language',
        iconRender: () => h(MdiTranslate),
        type: VgoOptionType.SELECT,
        options: localeOptions.map(option => ({ label: option.label, value: option.value })),
      },
      {
        label: $t('file_lite_i18n.reduce_motion'),
        key: 'reduceMotion',
        iconRender: noRowIcon,
        type: VgoOptionType.SWITCH,
        store: local.value,
      },
      {
        label: $t('file_lite_i18n.custom_title'),
        key: 'pageTitle',
        iconRender: () => h(MdiFormatTitle),
        type: VgoOptionType.INPUT,
        subtitle: $t('file_lite_i18n.shown_in_the_top_bar_and_the_bro'),
        props: {
          placeholder: $t('file_lite_i18n.custom_title'),
          onBlur: trimPageTitle,
        },
      },
    ]),
  },
  {
    label: $t('file_lite_i18n.apps'),
    key: 'apps',
    children: [
      {
        label: $t('file_lite_i18n.native_video_player'),
        key: 'isNativePlayer',
        iconRender: () => h(MdiPlayBoxOutline),
        type: VgoOptionType.SWITCH,
        store: local.value,
        subtitle: $t('file_lite_i18n.uses_the_html5_video_player_inst'),
      },
      {
        label: $t('file_lite_i18n.remember_last_opened_media'),
        key: 'rememberLastMedia',
        iconRender: () => h(MdiHistory),
        type: VgoOptionType.SWITCH,
        subtitle: $t('file_lite_i18n.media_player_shows_a_resume_butt', [$t('file_lite_i18n.media_player')]),
      },
      {
        label: $t('file_lite_i18n.open_apps_with_the_filtered_list'),
        key: 'openAppWithFilteredList',
        iconRender: () => h(MdiFilterVariant),
        type: VgoOptionType.SWITCH,
        store: local.value,
        subtitle: $t('file_lite_i18n.apps_will_use_filtered_list_item'),
      },
    ],
  },
  {
    label: $t('file_lite_i18n.file_management'),
    key: 'fileManagement',
    children: [
      {
        label: $t('file_lite_i18n.show_hidden'),
        key: 'showHidden',
        iconRender: () => h(MdiEyeOutline),
        type: VgoOptionType.SWITCH,
        store: local.value,
      },
      {
        label: $t('file_lite_i18n.show_folders_first'),
        key: 'sortFoldersFirst',
        iconRender: noRowIcon,
        type: VgoOptionType.SWITCH,
        store: local.value,
      },
      {
        label: $t('file_lite_i18n.disable_preview'),
        key: 'disablePreview',
        iconRender: () => h(MdiImageOffOutline),
        type: VgoOptionType.SWITCH,
        store: local.value,
        subtitle: $t('file_lite_i18n.hides_thumbnails_and_covers'),
      },
      {
        label: $t('file_lite_i18n.local_data'),
        key: 'localData',
        iconRender: () => h(MdiDatabaseOutline),
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
        iconRender: noRowIcon,
        type: VgoOptionType.SWITCH,
        store: debugSettings,
      },
      isDev && {
        label: 'Demo transfer window',
        key: 'demoTransfer',
        iconRender: noRowIcon,
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
        iconRender: noRowIcon,
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
        iconRender: noRowIcon,
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
        iconRender: noRowIcon,
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
  {
    label: $t('file_lite_i18n.about'),
    key: 'about',
    children: [
      {
        label: $t('file_lite_i18n.updates'),
        key: 'updates',
        iconRender: () => h(MdiUpdate),
        subtitle: updateStatusText.value,
        actionRender: () => h(UpdateChecker),
      },
      {
        label: $t('file_lite_i18n.update_channel'),
        key: 'updateChannel',
        iconRender: () => h(MdiSourceBranch),
        type: VgoOptionType.SELECT,
        options: [
          { label: $t('file_lite_i18n.update_channel_stable'), value: 'stable' },
          { label: $t('file_lite_i18n.update_channel_preview'), value: 'preview' },
        ],
      },
      {
        label: $t('file_lite_i18n.check_automatically'),
        key: 'updateAutoCheck',
        iconRender: () => h(MdiCalendarSync),
        type: VgoOptionType.SWITCH,
        subtitle: $t('file_lite_i18n.check_automatically_hint'),
      },
      {
        label: $t('file_lite_i18n.version'),
        key: 'version',
        iconRender: () => h(MdiTagOutline),
        subtitle: versionSubtitle.value,
      },
    ],
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
}

.settings :deep(.settings-row-actions) {
  display: flex;
  gap: var(--vgo-space-1);
}

.settings :deep(.vgo-option-item__child) {
  flex-wrap: wrap;
}
</style>
