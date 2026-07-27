<script lang="ts" setup>
import type { IEntry } from '@/types/server'
import ContextMenu from '@imengyu/vue3-context-menu'
import { PKG_NAME, VERSION } from '@/enum/version.ts'
import { colorThemeOptions, menuThemeOptions, setGlobalTheme, ThemeMode } from '@/hooks/use-global-theme.ts'
import { toggleRememberLastMedia } from '@/hooks/use-last-opened-media'
import { useWakeLockToggle } from '@/hooks/use-wake-lock'
import { getPreviewSizeLabel, localSettingsStore, previewSizeOptions, settingsStore } from '@/store/index.ts'
import { enableEruda } from '@/utils/debug'
import { InternalAppEnum } from '@/views/Apps/apps'
import { openAppWindow } from '@/views/Apps/apps-store'
import { showInputPrompt } from '@/views/FileManager/ExplorerUI/input-prompt.ts'
import FileManager from '@/views/FileManager/FileManager.vue'
import AppsEntry from './Apps/AppsEntry.vue'

const { isSupported: isWakeLockSupported, isActive: isWakeLockActive, toggleWakeLock } = useWakeLockToggle()

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

function showMenu(event: MouseEvent) {
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
            icon: localSettingsStore.value.einkMode ? 'mdi mdi-check' : '',
            label: `E-ink mode`,
            divided: true,
            onClick: () => {
              localSettingsStore.value.einkMode = !localSettingsStore.value.einkMode
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
            icon: enableEruda.value ? 'mdi mdi-check' : '',
            onClick: () => {
              enableEruda.value = !enableEruda.value
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
</script>

<template>
  <FileManager>
    <template #headerRight>
      <button class="btn-action btn-no-style" title="Menu" @click="showMenu">
        <span class="mdi mdi-menu" />
      </button>
    </template>
  </FileManager>
  <AppsEntry />
</template>
