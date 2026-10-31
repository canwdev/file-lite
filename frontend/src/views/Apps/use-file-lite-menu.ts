import type { MenuItem } from '@canwdev/vgo-ui'
import type { IEntry } from '@/types/server'
import { useContextMenuTrigger } from '@canwdev/vgo-ui'
import { pluginList, refreshPlugins } from '@/api/plugins'
import { PKG_NAME, VERSION } from '@/enum/version.ts'
import { useWakeLockToggle } from '@/hooks/use-wake-lock'
import { authSessionRenewable } from '@/store/auth'
import { baseContextMenuOptions } from '@/utils/context-menu'
import { resolveMenuIcons } from '@/utils/icons'
import { InternalAppEnum } from '@/views/Apps/apps'
import { openAppWindow, openPluginWindow, toggleKeyboardShortcutsApp, toggleSettingsApp, toggleTextSyncApp } from '@/views/Apps/apps-store'
import PluginIcon from '@/views/Apps/PluginIcon.vue'
import { pluginTargets, targetVersion } from '@/views/Apps/registry'

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

export function useFileLiteMenu() {
  const router = useRouter()
  const { isSupported: isWakeLockSupported, isActive: isWakeLockActive, toggleWakeLock } = useWakeLockToggle()

  /** 构建全局菜单的菜单项。 */
  function buildMenuItems(): MenuItem[] {
    return resolveMenuIcons(
      [
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
          shortcut: 'Ctrl+,',
          divided: true,
          onClick: () => {
            toggleSettingsApp()
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
        authSessionRenewable.value
          ? {
              label: $t('file_lite_i18n.ip_chooser') + ELLIPSIS,
              icon: 'mdi mdi-ip-network',
              onClick: () => {
                window.open(router.resolve({ name: 'IpChooserView' }).href, '_blank')
              },
            }
          : false,
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
   * 顶栏的插件菜单：与全局菜单并列的独立入口，只有装了插件才出现。
   * 菜单项每次打开时现取，所以插件安装 / 移除后 Refresh 一下就会反映出来。
   */
  function buildPluginMenuItems(): MenuItem[] {
    return resolveMenuIcons([
      {
        label: $t('file_lite_i18n.refresh'),
        icon: 'mdi mdi-refresh',
        divided: true,
        onClick: () => {
          void refreshPlugins()
        },
      },
      ...pluginTargets(pluginList.value).map(target => ({
        label: target.plugin.name,
        icon: h(PluginIcon, { plugin: target.plugin }),
        shortcut: targetVersion(target) || undefined,
        onClick: () => {
          openPluginWindow(target.plugin)
        },
      })),
    ])
  }

  const hasPlugins = computed(() => pluginList.value.length > 0)

  const {
    setTriggerRef: setPluginMenuTriggerRef,
    isOpen: pluginMenuOpen,
    toggle: togglePluginMenu,
  } = useContextMenuTrigger({
    ...baseContextMenuOptions,
    items: buildPluginMenuItems,
  })

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

  function toggleMenu() {
    if (menuOpen.value) {
      closeMenu()
      return
    }
    menuItems.value = buildMenuItems()
    if (!menuItems.value.length) {
      return
    }
    showMenu()
  }

  return {
    setMenuTriggerRef,
    menuOpen,
    toggleMenu,
    setPluginMenuTriggerRef,
    pluginMenuOpen,
    togglePluginMenu,
    hasPlugins,
  }
}
