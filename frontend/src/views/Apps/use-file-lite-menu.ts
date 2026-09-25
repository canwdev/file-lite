import type { MenuItem } from '@canwdev/vgo-ui'
import type { IEntry } from '@/types/server'
import { useContextMenuTrigger } from '@canwdev/vgo-ui'
import { ElCheckbox } from 'element-plus'
import { listPlugins, refreshPlugins } from '@/api/plugins'
import { applyUpdate, exitBackend, restartBackend } from '@/api/update'
import { isDev } from '@/enum'
import { PKG_NAME, VERSION } from '@/enum/version.ts'
import { useFullscreenToggle } from '@/hooks/use-fullscreen'
import { colorThemeOptions, setGlobalTheme, ThemeMode } from '@/hooks/use-global-theme.ts'
import { clearLastOpenedMediaMap, toggleRememberLastMedia } from '@/hooks/use-last-opened-media'
import { useWakeLockToggle } from '@/hooks/use-wake-lock'
import { serverCapabilities } from '@/store/capabilities.ts'
import { localSettingsStore, settingsStore } from '@/store/index.ts'
import { baseContextMenuOptions } from '@/utils/context-menu'
import { enableDebug } from '@/utils/debug'
import { mdiMenuIcon, resolveMenuIcons } from '@/utils/icons'
import { clearImageThumbCache, getImageThumbCacheStats } from '@/utils/image-thumb-cache'
import { InternalAppEnum } from '@/views/Apps/apps'
import { openAppWindow, openPluginWindow, toggleKeyboardShortcutsApp, toggleTextSyncApp } from '@/views/Apps/apps-store'
import PluginIcon from '@/views/Apps/PluginIcon.vue'
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
 * 重启后端进程（Development → Enable Debug），用来重载配置。
 * 确认后发请求，等 1s（服务重启完）刷新页面；进行中的传输会被切断，所以先问一次。
 */
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
    // 取消
    return
  }

  try {
    await restartBackend()
  }
  catch {
    // 失败原因已经由 service 拦截器 toast
    return
  }

  window.$message?.success('Restarting…')
  setTimeout(() => window.location.reload(), 1000)
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
  const router = useRouter()
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
    window.$message.success('Previews disabled')
  }

  async function clearImageCache() {
    const { entries, bytes, available } = await getImageThumbCacheStats()
    if (!available) {
      window.$message.warning('Image cache is unavailable in this browser')
      return
    }
    if (entries === 0) {
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
    const cacheLabel = `Image preview cache${entries > 0 ? ` (${entries} items · ${formatCacheBytes(bytes)})` : ''}`

    // 默认全选；用户取消勾选哪一项就不清哪一项
    const selected = reactive({
      media: true,
      collection: true,
      folderState: true,
      imageCache: true,
    })
    const options: { key: keyof typeof selected, label: string }[] = [
      { key: 'media', label: 'Last opened media per folder' },
      { key: 'collection', label: 'Collected items (Endless Gallery)' },
      { key: 'folderState', label: 'Folder state (scroll position & sort mode)' },
      { key: 'imageCache', label: cacheLabel },
    ]

    // message 用函数形式：勾选状态跟着 reactive 走，ElMessageBox 重渲染时读到最新值
    const message = () => h('div', { style: 'display: flex; flex-direction: column; gap: var(--vgo-space-2);' }, options.map(option => h(ElCheckbox, {
      'modelValue': selected[option.key],
      'onUpdate:modelValue': (value: string | number | boolean) => { selected[option.key] = Boolean(value) },
    }, option.label)))

    try {
      await window.$dialog.confirm(message, 'Clear Local Data', {
        confirmButtonText: 'Clear',
        cancelButtonText: 'Cancel',
      })
    }
    catch {
      // cancelled
      return
    }

    if (selected.media)
      clearLastOpenedMediaMap()
    if (selected.collection)
      clearCollection()
    if (selected.folderState)
      explorerStateMap.value = {}
    if (selected.imageCache)
      void clearImageThumbCache()

    if (options.some(option => selected[option.key]))
      window.$message.success('Local data cleared')
  }

  /** 构建全局菜单的菜单项；缓存统计与插件列表每次打开时现取，所以是异步的。 */
  async function buildMenuItems(): Promise<MenuItem[]> {
    const { entries: cacheEntries, bytes: cacheBytes, available: cacheAvailable } = await getImageThumbCacheStats()
    const plugins = await listPlugins().catch(() => [])
    const pluginsMenu: MenuItem | false = plugins.length > 0 && {
      label: 'Plugins',
      icon: 'mdi mdi-puzzle-outline',
      children: [
        {
          label: 'Refresh',
          icon: 'mdi mdi-refresh',
          divided: true,
          onClick: () => {
            void refreshPlugins()
          },
        },
        ...plugins.map(plugin => ({
          label: plugin.name,
          icon: h(PluginIcon, { plugin }),
          shortcut: plugin.version || undefined,
          onClick: () => {
            openPluginWindow(plugin)
          },
        })),
      ],
    }
    const imageCacheLabel = !cacheAvailable
      ? 'Image Cache: unavailable'
      : cacheEntries > 0
        ? `Image Cache: ${cacheEntries} items · ${formatCacheBytes(cacheBytes)}`
        : 'Image Cache: empty'
    return resolveMenuIcons(
      [
        pluginsMenu,
        {
          label: 'Text Sync',
          icon: 'mdi mdi-clipboard-outline',
          shortcut: 'F1',
          divided: true,
          onClick: () => {
            toggleTextSyncApp()
          },
        },
        {
          label: `Theme: ${(settingsStore.value.themeMode || '').replace(/^./, c => c.toUpperCase())} ${settingsStore.value.colorTheme}`,
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
            ...colorThemeOptions.map((item) => {
              const rgb = document.documentElement.classList.contains('dark')
                ? item.rgb.dark
                : item.rgb.light
              return {
                label: item.label,
                icon: mdiMenuIcon(
                  item.label === settingsStore.value.colorTheme ? 'checkbox-marked-circle' : 'checkbox-blank-circle',
                  { style: { color: `rgba(${rgb})` } },
                ),
                onClick: () => {
                  setGlobalTheme(item.label)
                },
              }
            }),
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
                {
                  icon: localSettingsStore.value.sortFoldersFirst ? 'mdi mdi-check' : '',
                  label: 'Show folders first',
                  onClick: () => {
                    localSettingsStore.value.sortFoldersFirst = !localSettingsStore.value.sortFoldersFirst
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
                  label: 'Enable Debug Console',
                  icon: enableDebug.value ? 'mdi mdi-check' : '',
                  onClick: () => {
                    enableDebug.value = !enableDebug.value
                  },
                },
                isDev && {
                  label: 'Demo Transfer Window',
                  icon: 'mdi mdi-bug-play-outline',
                  onClick: () => {
                    explorerBus.emit(ExplorerEvents.DEBUG_TRANSFER)
                  },
                },
                serverCapabilities.value.selfUpdate && {
                  icon: 'mdi file-upload-outline',
                  label: 'Update Backend Binary…',
                  onClick: handleUpdateBackend,

                },
                serverCapabilities.value.selfUpdate && {
                  icon: 'mdi mdi-refresh',
                  label: 'Restart Backend',
                  onClick: () => {
                    void handleRestartBackend()
                  },
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
          divided: true,
          onClick: () => {
            toggleFullscreen()
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
          label: 'Keyboard Shortcuts',
          icon: 'mdi mdi-keyboard-outline',
          shortcut: '?',
          divided: true,
          onClick: () => {
            toggleKeyboardShortcutsApp()
          },
        },
        {
          label: 'IP Chooser',
          icon: 'mdi mdi-ip-network',
          onClick: () => {
            void router.push({ name: 'IpChooserView' })
          },
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
      ].filter(Boolean) as MenuItem[],
    )
  }

  const menuItems = shallowRef<MenuItem[]>([])

  /**
   * 「Menu」按钮：点开 / 再点关闭，打开期间按钮保持激活。位置、开合状态与
   * 「点击外部关闭」的时序都交给 vgo-ui 的 trigger hook。
   */
  const {
    setTriggerRef: setMenuTriggerRef,
    isOpen: menuOpen,
    show: showMenu,
    close: closeMenu,
  } = useContextMenuTrigger({
    ...baseContextMenuOptions,
    items: () => menuItems.value,
  })

  async function toggleMenu() {
    if (menuOpen.value) {
      closeMenu()
      return
    }
    menuItems.value = await buildMenuItems()
    if (!menuItems.value.length) {
      return
    }
    showMenu()
  }

  return {
    setMenuTriggerRef,
    menuOpen,
    toggleMenu,
  }
}
