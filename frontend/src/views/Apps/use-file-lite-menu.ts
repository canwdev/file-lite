import type { MenuItem } from '@canwdev/vgo-ui'
import type { IEntry } from '@/types/server'
import { useContextMenuTrigger } from '@canwdev/vgo-ui'
import { listPlugins, refreshPlugins } from '@/api/plugins'
import { PKG_NAME, VERSION } from '@/enum/version.ts'
import { useFullscreenToggle } from '@/hooks/use-fullscreen'
import { useWakeLockToggle } from '@/hooks/use-wake-lock'
import { baseContextMenuOptions } from '@/utils/context-menu'
import { resolveMenuIcons } from '@/utils/icons'
import { InternalAppEnum } from '@/views/Apps/apps'
import { openAppWindow, openPluginWindow, toggleKeyboardShortcutsApp, toggleTextSyncApp } from '@/views/Apps/apps-store'
import PluginIcon from '@/views/Apps/PluginIcon.vue'

const internalSpeedTestEntry: IEntry = {
  name: 'SpeedTest',
  path: '',
  ext: '',
  isDirectory: false,
  hidden: false,
  lastModified: 0,
  birthtime: 0,
  size: 0,
  error: null,
}

const internalSettingsEntry: IEntry = {
  name: $t('file_lite_i18n.settings'),
  path: '',
  ext: '',
  isDirectory: false,
  hidden: false,
  lastModified: 0,
  birthtime: 0,
  size: 0,
  error: null,
}

export function useFileLiteMenu() {
  const router = useRouter()
  const { isSupported: isWakeLockSupported, isActive: isWakeLockActive, toggleWakeLock } = useWakeLockToggle()
  const { isSupported: isFullscreenSupported, isFullscreen, toggleFullscreen } = useFullscreenToggle()

  /** 构建全局菜单的菜单项；插件列表每次打开时现取，所以是异步的。 */
  async function buildMenuItems(): Promise<MenuItem[]> {
    const plugins = await listPlugins().catch(() => [])
    const pluginsMenu: MenuItem | false = plugins.length > 0 && {
      label: $t('file_lite_i18n.plugins'),
      icon: 'mdi mdi-puzzle-outline',
      children: [
        {
          label: $t('file_lite_i18n.refresh'),
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
    return resolveMenuIcons(
      [
        pluginsMenu,
        {
          label: $t('file_lite_i18n.text_sync'),
          icon: 'mdi mdi-clipboard-outline',
          shortcut: 'F1',
          divided: true,
          onClick: () => {
            toggleTextSyncApp()
          },
        },
        {
          label: $t('file_lite_i18n.settings'),
          icon: 'mdi mdi-cog',
          divided: true,
          onClick: () => {
            openAppWindow(InternalAppEnum.Settings, {
              absPath: '',
              item: internalSettingsEntry,
              basePath: '',
              list: [],
            })
          },
        },
        {
          label: isWakeLockSupported.value
            ? $t('file_lite_i18n.browser_wake_lock_0', [isWakeLockActive.value ? $t('file_lite_i18n.on') : $t('file_lite_i18n.off')])
            : $t('file_lite_i18n.browser_wake_lock_unsupported'),
          icon: isWakeLockActive.value ? 'mdi mdi-check' : 'mdi mdi-monitor-eye',
          disabled: !isWakeLockSupported.value,
          onClick: () => {
            toggleWakeLock()
          },
        },
        {
          label: isFullscreenSupported.value
            ? $t('file_lite_i18n.fullscreen_0', [isFullscreen.value ? $t('file_lite_i18n.on') : $t('file_lite_i18n.off')])
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
          label: $t('file_lite_i18n.keyboard_shortcuts'),
          icon: 'mdi mdi-keyboard-outline',
          shortcut: '?',
          divided: true,
          onClick: () => {
            toggleKeyboardShortcutsApp()
          },
        },
        {
          label: $t('file_lite_i18n.ip_chooser') + ELLIPSIS,
          icon: 'mdi mdi-ip-network',
          onClick: () => {
            window.open(router.resolve({ name: 'IpChooserView' }).href, '_blank')
          },
        },
        {
          label: $t('file_lite_i18n.legacy_page_for_ie8') + ELLIPSIS,
          icon: 'mdi mdi-microsoft-internet-explorer',
          onClick: () => {
            window.open('/ie')
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
          label: $t('file_lite_i18n.logout'),
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
