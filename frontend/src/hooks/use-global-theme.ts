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
  {
    label: 'Node.js Green',
    rgb: '76,175,80',
  },
  {
    label: 'Golang Blue',
    rgb: '83,173,228',
  },
  {
    label: 'JavaScript Yellow',
    rgb: '247,223,30',
  },
  {
    label: 'Python Gold',
    rgb: '255,193,7',
  },
  {
    label: 'Swift Coral',
    rgb: '255,112,67',
  },
  {
    label: 'Apple Pink',
    rgb: '255,45,85',
  },
  {
    label: 'Ruby Red',
    rgb: '198,40,40',
  },
  {
    label: 'Rust Brown',
    rgb: '121,85,72',
  },
  {
    label: 'Kotlin Indigo',
    rgb: '63,81,181',
  },
  {
    label: 'PHP Lavender',
    rgb: '149,117,205',
  },
  {
    label: 'Haskell Slate',
    rgb: '96,125,139',
  },
  {
    label: 'Dart Teal',
    rgb: '0,150,136',
  },
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
      document.documentElement.classList.toggle('reduce-motion', enabled)
    },
    { immediate: true },
  )
}
