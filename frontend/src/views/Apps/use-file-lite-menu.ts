import type { MenuItem } from '@imengyu/vue3-context-menu'
import type { IEntry } from '@/types/server'
import ContextMenu from '@imengyu/vue3-context-menu'
import { applyUpdate, exitBackend } from '@/api/update'
import { PKG_NAME, VERSION } from '@/enum/version.ts'
import { useFullscreenToggle } from '@/hooks/use-fullscreen'
import { colorThemeOptions, menuThemeOptions, setGlobalTheme, ThemeMode } from '@/hooks/use-global-theme.ts'
import { clearLastOpenedMediaMap, toggleRememberLastMedia } from '@/hooks/use-last-opened-media'
import { useWakeLockToggle } from '@/hooks/use-wake-lock'
import { serverCapabilities } from '@/store/capabilities.ts'
import { localSettingsStore, settingsStore } from '@/store/index.ts'
import { enableDebug } from '@/utils/debug'
import { mdiMenuIcon, resolveMenuIcons } from '@/utils/icons'
import { clearImageThumbCache, getImageThumbCacheStats } from '@/utils/image-thumb-cache'
import { InternalAppEnum } from '@/views/Apps/apps'
import { openAppWindow } from '@/views/Apps/apps-store'
import { explorerStateMap } from '@/views/FileManager/ExplorerUI/explorer-state'
import { showInputPrompt } from '@/views/FileManager/ExplorerUI/input-prompt.ts'
import explorerBus, { ExplorerEvents } from '@/views/FileManager/utils/bus'
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

/**
 * 选一个后端二进制上传。成功等 1s（服务重启完）后刷新页面；
 * 失败原因由 service 拦截器 toast，这里不需要再补一份。
 */
function handleUpdateBackend() {
  const input = document.createElement('input')
  input.type = 'file'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) {
      return
    }
    applyUpdate(file)
      .then((res) => {
        window.$message?.success(`Updated to v${res.to}, restarting…`)
        setTimeout(() => window.location.reload(), 1000)
      })
      .catch(() => {
        // 失败原因已经由 service 拦截器 toast
      })
  }
  input.click()
}

/**
 * 退出后端进程（Development → Enable Debug）。二次确认后直接退出，退出后弹窗告知。
 * 不尝试关闭标签页：浏览器只允许关闭脚本打开的标签页，普通标签页会静默失败。
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
    // 取消
    return
  }

  try {
    await exitBackend()
  }
  catch {
    // 失败原因已经由 service 拦截器 toast
    return
  }

  // 后端在响应之后才真正退出，等它退出再弹窗。
  setTimeout(() => {
    void window.$dialog.alert('Backend exited', 'Exit Backend', { type: 'info' }).catch(() => {
      // 直接关掉了弹窗
    })
  }, 600)
}

export function useFileLiteMenu() {
  const { isSupported: isWakeLockSupported, isActive: isWakeLockActive, toggleWakeLock } = useWakeLockToggle()
  const { isSupported: isFullscreenSupported, isFullscreen, toggleFullscreen } = useFullscreenToggle()
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

  /**
   * 开关内容预览。关闭时顺手清空缩略图缓存 —— 它们已经不会再被用到，
   * 留着只是白占浏览器配额，所以这一个开关同时是「别再缓存占我空间」的手段。
   */
  async function toggleDisablePreview() {
    const disabled = !localSettingsStore.value.disablePreview
    // 先改开关再清缓存：否则清理过程中滚动出来的图还会继续写入新缓存
    localSettingsStore.value.disablePreview = disabled
    if (!disabled)
      return

    await clearImageThumbCache()
    window.$message.success('Previews disabled · image cache cleared')
  }

  async function clearImageCache() {
    const { entries, bytes, available } = await getImageThumbCacheStats()
    if (!available) {
      window.$message.warning('Image cache is unavailable in this browser')
      return
    }
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
    const { entries: cacheEntries, bytes: cacheBytes, available: cacheAvailable } = await getImageThumbCacheStats()
    const imageCacheLabel = !cacheAvailable
      ? 'Image Cache: unavailable'
      : cacheEntries > 0
        ? `Image Cache: ${cacheEntries} items · ${formatCacheBytes(cacheBytes)}`
        : 'Image Cache: empty'
    const button = (event.target instanceof Element ? event.target : null)?.closest('button') as HTMLElement | undefined
    const rect = button?.getBoundingClientRect()

    ContextMenu.showContextMenu({
      x: rect?.right || event.x,
      y: rect?.top || event.y,
      ...menuThemeOptions,
      items: resolveMenuIcons([
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
              label: item.label.replace(/^./, c => c.toUpperCase()),
            })),
            {
              icon: localSettingsStore.value.reduceMotion ? 'mdi mdi-check' : '',
              label: `Reduce Motion`,
              divided: true,
              onClick: () => {
                localSettingsStore.value.reduceMotion = !localSettingsStore.value.reduceMotion
              },
            },
            // Color theme
            ...colorThemeOptions.map(item => ({
              label: item.label,
              // icon: item.rgb === settingsStore.value.colorTheme ? 'mdi mdi-check' : '',
              icon: mdiMenuIcon(
                item.rgb === settingsStore.value.colorTheme ? 'checkbox-marked-circle' : 'checkbox-blank-circle',
                { style: { color: `rgba(${item.rgb})` } },
              ),
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
              label: 'Development',
              icon: 'mdi mdi-test-tube',
              children: [
                {
                  label: 'Enable Debug',
                  icon: enableDebug.value ? 'mdi mdi-check' : '',
                  onClick: () => {
                    enableDebug.value = !enableDebug.value
                  },
                },
                {
                  label: 'Debug Transfer Window',
                  icon: 'mdi mdi-bug-play-outline',
                  onClick: () => {
                    explorerBus.emit(ExplorerEvents.DEBUG_TRANSFER)
                  },
                },
                serverCapabilities.value.selfUpdate && {
                  icon: 'mdi mdi-server',
                  label: 'Update Backend Binary…',
                  onClick: handleUpdateBackend,

                },
                serverCapabilities.value.selfUpdate && {
                  icon: 'mdi mdi-logout',
                  label: 'Exit Backend',
                  onClick: () => {
                    void handleExitBackend()
                  },
                },
              ].filter(Boolean),
              divided: true,
            },
            {
              icon: localSettingsStore.value.disablePreview ? 'mdi mdi-check' : '',
              label: `Disable Preview`,
              onClick: () => {
                void toggleDisablePreview()
              },
            },
            !localSettingsStore.value.disablePreview && {
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
          ].filter(Boolean) as MenuItem[],
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
          divided: true,
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
        },
        {
          label: isFullscreenSupported.value
            ? `Fullscreen: ${isFullscreen.value ? 'On' : 'Off'}`
            : 'Fullscreen (unsupported)',
          icon: isFullscreen.value ? 'mdi mdi-fullscreen-exit' : 'mdi mdi-fullscreen',
          disabled: !isFullscreenSupported.value,
          onClick: () => {
            toggleFullscreen()
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
      ]),
    })
  }

  return {
    showMenu,
  }
}
