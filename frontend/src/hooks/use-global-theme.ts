import { useElementPlusTheme } from '@canwdev/vgo-ui'
import { useStorage } from '@vueuse/core'
import { LsKeys } from '@/enum'

export enum ThemeMode {
  Auto = 'auto',
  Light = 'light',
  Dark = 'dark',
}

export const themeMode = useStorage(LsKeys.THEME_MODE, ThemeMode.Auto)
export const contextMenuTheme = ref('flat dark')

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
export const colorTheme = useStorage(LsKeys.COLOR_THEME, '')

let changeElementPlusTheme: ((color?: string) => void) | undefined

export function rgbToHex(rgb: string) {
  const [r, g, b] = rgb
    .split(',')
    .map(v => Number.parseInt(v.trim(), 10))
  if ([r, g, b].some(v => Number.isNaN(v) || v < 0 || v > 255)) {
    return ''
  }
  return `#${[r, g, b]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('')}`
}

export function setGlobalTheme(rgb: string) {
  if (!rgb) {
    colorTheme.value = ''
    document.documentElement.style.removeProperty('--vgo-primary-rgb')
    changeElementPlusTheme?.(rgbToHex(getCurrentPrimaryRgb()))
    return
  }

  const hex = rgbToHex(rgb)
  if (!hex)
    return

  const normalizedRgb = rgb
    .split(',')
    .map(v => Number.parseInt(v.trim(), 10))
    .join(',')

  colorTheme.value = normalizedRgb
  document.documentElement.style.setProperty('--vgo-primary-rgb', normalizedRgb)
  changeElementPlusTheme?.(hex)
}

export function getCurrentPrimaryRgb() {
  return getComputedStyle(document.documentElement).getPropertyValue('--vgo-primary-rgb')
}

export function useGlobalTheme() {
  const { changeTheme } = useElementPlusTheme()
  changeElementPlusTheme = changeTheme
  const isSystemDarkMode = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)
  const handleSystemThemeChange = (event: any) => {
    isSystemDarkMode.value = Boolean(event.matches)
  }

  onBeforeMount(() => {
    if (colorTheme.value) {
      setGlobalTheme(colorTheme.value)
      return
    }
    changeTheme(rgbToHex(getCurrentPrimaryRgb()))
  })
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
        // Element Plus 黑暗模式 https://element-plus.org/zh-CN/guide/dark-mode.html
        document.documentElement.classList.add('dark')
        contextMenuTheme.value = 'flat dark'
      }
      else {
        document.documentElement.classList.remove('dark')
        contextMenuTheme.value = 'flat'
      }
    },
    { immediate: true },
  )
}
