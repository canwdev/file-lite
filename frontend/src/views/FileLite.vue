<script lang="ts" setup>
import ContextMenu from '@imengyu/vue3-context-menu'
import { PKG_NAME, VERSION } from '@server/enum/version.ts'
import { contextMenuTheme, ThemeMode, themeMode } from '@/hooks/use-global-theme.ts'
import FileManager from '@/views/FileManager/FileManager.vue'
import AppsEntry from './Apps/AppsEntry.vue'

function showMenu(event: MouseEvent) {
  const button = event.target?.closest('button') as HTMLElement
  const rect = button?.getBoundingClientRect()

  ContextMenu.showContextMenu({
    x: rect?.right || event.x,
    y: rect?.top || event.y,
    theme: contextMenuTheme.value,
    items: [
      {
        label: `Theme: ${themeMode.value}`,
        icon: 'mdi mdi-theme-light-dark',
        children: [
          {
            label: ThemeMode.Auto,
            onClick: () => {
              themeMode.value = ThemeMode.Auto
            },
          },
          {
            label: ThemeMode.Light,
            onClick: () => {
              themeMode.value = ThemeMode.Light
            },
          },
          {
            label: ThemeMode.Dark,
            onClick: () => {
              themeMode.value = ThemeMode.Dark
            },
          },
        ].map(item => ({
          ...item,
          icon: item.label === themeMode.value ? `mdi mdi-check` : '',
        })),
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
          window.$logout()
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
