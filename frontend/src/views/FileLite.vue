<script lang="ts" setup>
import ContextMenu from '@imengyu/vue3-context-menu'
import { PKG_NAME, VERSION } from '@/enum/version.ts'
import { colorThemeOptions, menuThemeOptions, setGlobalTheme, ThemeMode } from '@/hooks/use-global-theme.ts'
import { settingsStore } from '@/store/index.ts'
import FileManager from '@/views/FileManager/FileManager.vue'
import AppsEntry from './Apps/AppsEntry.vue'

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
            icon: settingsStore.value.isNativePlayer ? 'mdi mdi-check' : '',
            label: `Use native player`,
            onClick: () => {
              settingsStore.value.isNativePlayer = !settingsStore.value.isNativePlayer
            },
          },
          {
            icon: settingsStore.value.enablePreview ? 'mdi mdi-check' : '',
            label: `Enable preview`,
            onClick: () => {
              settingsStore.value.enablePreview = !settingsStore.value.enablePreview
            },
          },
          {
            icon: settingsStore.value.appSingleInstance ? 'mdi mdi-check' : '',
            label: `Media app single instance`,
            onClick: () => {
              settingsStore.value.appSingleInstance = !settingsStore.value.appSingleInstance
            },
          },

        ],
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
