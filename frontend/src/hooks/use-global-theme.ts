import { useStorage } from '@vueuse/core'

export enum ThemeMode {
  Auto = 'auto',
  Light = 'light',
  Dark = 'dark',
}

export const themeMode = useStorage('file_lite_theme_mode', ThemeMode.Auto)
export const contextMenuTheme = ref('flat dark')

export function useGlobalTheme() {
  const isSystemDarkMode = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)
  const handleSystemThemeChange = (event: any) => {
    isSystemDarkMode.value = Boolean(event.matches)
  }

  onBeforeUnmount(() => {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .removeEventListener('change', handleSystemThemeChange)
  })
  onMounted(() => {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', handleSystemThemeChange)
  })

  const isAppDarkMode = computed(() => {
    if (themeMode.value === ThemeMode.Auto) {
      return isSystemDarkMode.value
    }
    return themeMode.value === ThemeMode.Dark
  })
  watch(
    isAppDarkMode,
    (val) => {
      if (val) {
        // vgo-ui 黑暗模式
        document.body.classList.add('dark')

        // Element Plus 黑暗模式 https://element-plus.org/zh-CN/guide/dark-mode.html
        document.documentElement.classList.add('dark')
        contextMenuTheme.value = 'flat dark'
      }
      else {
        document.body.classList.remove('dark')
        document.documentElement.classList.remove('dark')
        contextMenuTheme.value = 'flat'
      }
    },
    { immediate: true },
  )
}
