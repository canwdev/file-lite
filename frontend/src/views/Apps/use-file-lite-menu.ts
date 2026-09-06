import type { IEntry } from '@/types/server'
import ContextMenu from '@imengyu/vue3-context-menu'
import { PKG_NAME, VERSION } from '@/enum/version.ts'
import { colorThemeOptions, menuThemeOptions, setGlobalTheme, ThemeMode } from '@/hooks/use-global-theme.ts'
import { clearLastOpenedMediaMap, toggleRememberLastMedia } from '@/hooks/use-last-opened-media'
import { useWakeLockToggle } from '@/hooks/use-wake-lock'
import { getPreviewSizeLabel, localSettingsStore, previewSizeOptions, settingsStore } from '@/store/index.ts'
import { enableDebug } from '@/utils/debug'
import { clearImageThumbCache, getImageThumbCacheStats } from '@/utils/image-thumb-cache'
import { InternalAppEnum } from '@/views/Apps/apps'
import { openAppWindow } from '@/views/Apps/apps-store'
import { explorerStateMap } from '@/views/FileManager/ExplorerUI/explorer-state'
import { showInputPrompt } from '@/views/FileManager/ExplorerUI/input-prompt.ts'
import { useCollection } from './EndlessGallery/use-collection'

async function handleSetTitle() {
  try {
    const value = await showInputPrompt({
      title: 'Set Page Title',
      value: settingsStore.value.pageTitle,
      allowEmpty: true,
    })
    settingsStore.value.pageTitle = value.trim()
  }
  catch {
    // cancelled
  }
}

const internalTextSyncEntry: IEntry = {
  name: 'TextSync',
  ext: '',
  isDirectory: false,
  hidden: false,
  lastModified: 0,
  birthtime: 0,
  size: 0,
  error: null,
}

const internalSpeedTestEntry: IEntry = {
  name: 'SpeedTest',
  ext: '',
  isDirectory: false,
  hidden: false,
  lastModified: 0,
  birthtime: 0,
  size: 0,
  error: null,
}

export function useFileLiteMenu() {
  const { isSupported: isWakeLockSupported, isActive: isWakeLockActive, toggleWakeLock } = useWakeLockToggle()
  const { clearCollection } = useCollection()

  function formatCacheBytes(bytes: number) {
    if (bytes >= 1024 ** 3)
      return `${(bytes / 1024 ** 3).toFixed(1)} GB`
    if (bytes >= 1024 ** 2)
      return `${(bytes / 1024 ** 2).toFixed(1)} MB`
    if (bytes >= 1024)
      return `${Math.round(bytes / 1024)} KB`
    return `${bytes} B`
  }

  async function clearImageCache() {
    const { entries, bytes } = await getImageThumbCacheStats()
    if (entries === 0) {
      window.$message.info('Image cache is already empty')
      return
    }
    try {
      await window.$dialog.confirm(
        `<div>This will clear ${entries} cached image thumbnails (${formatCacheBytes(bytes)}).</div>`,
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
    }
    catch {
      // cancelled
    }
  }

  async function clearLocalData() {
    const { entries, bytes } = await getImageThumbCacheStats()
    const message = [
      '<div>This will clear the following data:</div>',
      '<ul style="margin: 8px 0 0; padding-left: 18px;">',
      '<li>Last opened media per folder</li>',
      '<li>Collected items (Endless Gallery)</li>',
      '<li>Folder state (scroll position &amp; sort mode)</li>',
      `<li>Image preview cache${entries > 0 ? ` (${entries} items · ${formatCacheBytes(bytes)})` : ''}</li>`,
      '</ul>',
    ].join('')
    window.$dialog.confirm(message, 'Clear Local Data', {
      type: 'warning',
      confirmButtonText: 'Clear',
      cancelButtonText: 'Cancel',
      dangerouslyUseHTMLString: true,
    }).then(() => {
      clearLastOpenedMediaMap()
      clearCollection()
      explorerStateMap.value = {}
      void clearImageThumbCache()
      window.$message.success('Local data cleared')
    }).catch(() => {
      // cancelled
    })
  }

  async function showMenu(event: MouseEvent) {
    const { entries: cacheEntries, bytes: cacheBytes } = await getImageThumbCacheStats()
    const imageCacheLabel = cacheEntries > 0
      ? `Image cache: ${cacheEntries} items · ${formatCacheBytes(cacheBytes)}`
      : 'Image cache: empty'
    const button = (event.target instanceof Element ? event.target : null)?.closest('button') as HTMLElement | undefined
    const rect = button?.getBoundingClientRect()

    ContextMenu.showContextMenu({
      x: rect?.right || event.x,
      y: rect?.top || event.y,
      ...menuThemeOptions,
      items: [
        {
          label: `Theme: ${settingsStore.value.themeMode}`,
          icon: 'mdi mdi-theme-light-dark',
          children: [
          // Light/Dark theme
            ...[
              {
                label: ThemeMode.Auto,
                onClick: () => {
                  settingsStore.value.themeMode = ThemeMode.Auto
                },
              },
              {
                label: ThemeMode.Light,
                onClick: () => {
                  settingsStore.value.themeMode = ThemeMode.Light
                },
              },
              {
                label: ThemeMode.Dark,
                onClick: () => {
                  settingsStore.value.themeMode = ThemeMode.Dark
                },
                divided: true,
              },
            ].map(item => ({
              ...item,
              icon: item.label === settingsStore.value.themeMode ? `mdi mdi-check` : '',
            })),
            {
              icon: localSettingsStore.value.reduceMotion ? 'mdi mdi-check' : '',
              label: `Reduce motion`,
              divided: true,
              onClick: () => {
                localSettingsStore.value.reduceMotion = !localSettingsStore.value.reduceMotion
              },
            },
            // Color theme
            ...colorThemeOptions.map(item => ({
              label: item.label,
              // icon: item.rgb === settingsStore.value.colorTheme ? 'mdi mdi-check' : '',
              icon: h('span', {
                class: `mdi ${item.rgb === settingsStore.value.colorTheme ? 'mdi-checkbox-marked-circle' : 'mdi-checkbox-blank-circle'}`,
                style: { color: `rgba(${item.rgb})` },
              }),
              onClick: () => {
                setGlobalTheme(item.rgb)
              },
            })),
          ],
        },
        {
          label: `Config`,
          icon: 'mdi mdi-cog',
          divided: true,
          children: [
            {
              icon: 'mdi mdi-image-search',
              label: `Preview size: ${getPreviewSizeLabel(localSettingsStore.value.previewSize)}`,
              children: previewSizeOptions.map(item => ({
                icon: localSettingsStore.value.previewSize === item.value ? 'mdi mdi-check' : '',
                label: item.label,
                onClick: () => {
                  localSettingsStore.value.previewSize = item.value
                },
              })),
            },
            {
              label: `App Settings`,
              children: [
                {
                  icon: localSettingsStore.value.isNativePlayer ? 'mdi mdi-check' : '',
                  label: `Use native video player`,
                  onClick: () => {
                    localSettingsStore.value.isNativePlayer = !localSettingsStore.value.isNativePlayer
                  },
                },
                {
                  icon: localSettingsStore.value.appSingleInstance ? 'mdi mdi-check' : '',
                  label: `App Single instance`,
                  onClick: () => {
                    localSettingsStore.value.appSingleInstance = !localSettingsStore.value.appSingleInstance
                  },
                },
                {
                  icon: settingsStore.value.rememberLastMedia ? 'mdi mdi-check' : '',
                  label: `Remember last opened media in Media Player`,
                  onClick: () => {
                    toggleRememberLastMedia()
                  },
                },
                {
                  icon: localSettingsStore.value.openAppWithFilteredList
                    ? 'mdi mdi-filter-check-outline'
                    : 'mdi mdi-filter-off-outline',
                  label: localSettingsStore.value.openAppWithFilteredList
                    ? 'Apps open with filtered list'
                    : 'Apps open without filtered list',
                  onClick: () => {
                    localSettingsStore.value.openAppWithFilteredList = !localSettingsStore.value.openAppWithFilteredList
                  },
                },
              ],
              divided: true,
            },
            {
              label: settingsStore.value.pageTitle.trim()
                ? `Title: ${settingsStore.value.pageTitle.trim()}`
                : 'Set Title',
              icon: 'mdi mdi-format-title',
              onClick: () => {
                void handleSetTitle()
              },
            },
            {
              label: 'Enable Debug',
              icon: enableDebug.value ? 'mdi mdi-check' : '',
              onClick: () => {
                enableDebug.value = !enableDebug.value
              },
            },
            {
              label: imageCacheLabel,
              icon: 'mdi mdi-image-multiple-outline',
              onClick: () => {
                void clearImageCache()
              },
            },
            {
              label: 'Clear Local Data',
              icon: 'mdi mdi-broom',
              onClick: () => {
                clearLocalData()
              },
            },
          ],
        },
        {
          label: 'Text Sync',
          icon: 'mdi mdi-clipboard',
          onClick: () => {
            openAppWindow(InternalAppEnum.TextSync, {
              absPath: '',
              item: internalTextSyncEntry,
              basePath: '',
              list: [],
            })
          },
        },
        {
          label: 'Speed Test',
          icon: 'mdi mdi-speedometer',
          onClick: () => {
            openAppWindow(InternalAppEnum.SpeedTest, {
              absPath: '',
              item: internalSpeedTestEntry,
              basePath: '',
              list: [],
            })
          },
        },
        {
          label: isWakeLockSupported.value
            ? `Browser Wake Lock: ${isWakeLockActive.value ? 'On' : 'Off'}`
            : 'Browser Wake Lock (unsupported)',
          icon: isWakeLockActive.value ? 'mdi mdi-check' : 'mdi mdi-monitor-eye',
          disabled: !isWakeLockSupported.value,
          onClick: () => {
            toggleWakeLock()
          },
          divided: true,
        },
        {
          label: `${PKG_NAME} v${VERSION}`,
          icon: 'mdi mdi-github',
          onClick: () => {
            window.open('https://github.com/canwdev/file-lite', '_blank')
          },
        },
        {
          label: 'Logout',
          icon: 'mdi mdi-logout',
          onClick: () => {
            window.$logout(true)
          },
        },
      ],
    })
  }

  return {
    showMenu,
  }
}
