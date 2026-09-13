import { rgbToHex, syncPrimaryColor, useElementPlusTheme } from '@canwdev/vgo-ui'
import { localSettingsStore, settingsStore } from '@/store'

export { rgbToHex }

export enum ThemeMode {
  Auto = 'auto',
  Light = 'light',
  Dark = 'dark',
}

// https://docs.imengyu.top/vue3-context-menu-docs/en/guide/theme.html
const mxContextMenuTheme = 'flat' // mac,win10,flat,default
export const menuThemeOptions = reactive({
  theme: `${mxContextMenuTheme} dark`,
  // menuTransitionProps: {
  //   name: 'mx-fade',
  // },
  /** 防止滚动关闭菜单 */
  closeWhenScroll: false,
})

export const colorThemeOptions = [
  { label: 'Red', rgb: '244,67,54' },
  { label: 'Pink', rgb: '233,30,99' },
  { label: 'Purple', rgb: '156,39,176' },
  { label: 'Deep Purple', rgb: '103,58,183' },
  { label: 'Indigo', rgb: '63,81,181' },
  { label: 'Blue', rgb: '33,150,243' },
  { label: 'Light Blue', rgb: '3,169,244' },
  { label: 'Cyan', rgb: '0,188,212' },
  { label: 'Teal', rgb: '0,150,136' },
  { label: 'Green', rgb: '76,175,80' },
  { label: 'Light Green', rgb: '139,195,74' },
  { label: 'Lime', rgb: '205,220,57' },
  { label: 'Yellow', rgb: '255,235,59' },
  { label: 'Amber', rgb: '255,193,7' },
  { label: 'Orange', rgb: '255,152,0' },
  { label: 'Deep Orange', rgb: '255,87,34' },
  { label: 'Brown', rgb: '121,85,72' },
  { label: 'Grey', rgb: '158,158,158' },
  { label: 'Blue Grey', rgb: '96,125,139' },
]
let changeElementPlusTheme: ((color?: string) => void) | undefined

export function setGlobalTheme(rgb: string) {
  const normalizedRgb = rgb
    .split(',')
    .map(v => Number.parseInt(v.trim(), 10))
    .filter(v => !Number.isNaN(v))
    .join(',')

  settingsStore.value.colorTheme = normalizedRgb
}

export function getCurrentPrimaryRgb() {
  return getComputedStyle(document.documentElement).getPropertyValue('--vgo-primary-rgb')
}

function applyGlobalTheme(rgb: string) {
  syncPrimaryColor(rgb, changeElementPlusTheme!)
}

export function useGlobalTheme() {
  const { changeTheme } = useElementPlusTheme()
  changeElementPlusTheme = changeTheme
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
    if (settingsStore.value.themeMode === ThemeMode.Auto) {
      return isSystemDarkMode.value
    }
    return settingsStore.value.themeMode === ThemeMode.Dark
  })
  watch(
    () => settingsStore.value.colorTheme,
    (value) => {
      applyGlobalTheme(value)
    },
    { immediate: true },
  )
  watch(
    isAppDarkMode,
    (val) => {
      if (val) {
        // Element Plus 黑暗模式 https://element-plus.org/zh-CN/guide/dark-mode.html
        document.documentElement.classList.add('dark')
        menuThemeOptions.theme = `${mxContextMenuTheme} dark`
      }
      else {
        document.documentElement.classList.remove('dark')
        menuThemeOptions.theme = mxContextMenuTheme
      }
    },
    { immediate: true },
  )
  watch(
    () => localSettingsStore.value.reduceMotion,
    (enabled) => {
      document.body.classList.toggle('reduce-motion', enabled)
    },
    { immediate: true },
  )
}
