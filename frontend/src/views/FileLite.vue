<script lang="ts" setup>
import ContextMenu from '@imengyu/vue3-context-menu'
import { PKG_NAME, VERSION } from '@/enum/version.ts'
import { contextMenuTheme, ThemeMode, themeMode } from '@/hooks/use-global-theme.ts'
import { isNativePlayer } from '@/store/index.ts'
import FileManager from '@/views/FileManager/FileManager.vue'
import AppsEntry from './Apps/AppsEntry.vue'

function showMenu(event: MouseEvent) {
  const button = (event.target instanceof Element ? event.target : null)?.closest('button') as HTMLElement | undefined
  const rect = button?.getBoundingClientRect()

  ContextMenu.showContextMenu({
    x: rect?.right || event.x,
    y: rect?.top || event.y,
    theme: contextMenuTheme.value,
    closeWhenScroll: false, // ← 防止滚动关闭菜单
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
        label: `Config`,
        icon: 'mdi mdi-cog',
        children: [
          {
            icon: isNativePlayer.value ? 'mdi mdi-check' : '',
            label: `Use native player`,
            onClick: () => {
              isNativePlayer.value = !isNativePlayer.value
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
