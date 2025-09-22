<script lang="ts" setup>
import FileManager from '@/views/FileManager/FileManager.vue'
import AppsEntry from './Apps/AppsEntry.vue'
import ContextMenu from '@imengyu/vue3-context-menu'
import {contextMenuTheme, ThemeMode, themeMode} from '@/hooks/use-global-theme.ts'

const showMenu = (event: MouseEvent) => {
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
        onClick: () => {
          if (themeMode.value === ThemeMode.Auto) {
            themeMode.value = ThemeMode.Dark
          } else if (themeMode.value === ThemeMode.Light) {
            themeMode.value = ThemeMode.Auto
          } else {
            themeMode.value = ThemeMode.Light
          }
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
        <span class="mdi mdi-menu"></span>
      </button>
    </template>
  </FileManager>
  <AppsEntry />
</template>
