import { rgbToHex, syncPrimaryColor, useElementPlusTheme } from '@canwdev/vgo-ui'
import { localSettingsStore, settingsStore } from '@/store'

export { rgbToHex }

export enum ThemeMode {
  Auto = 'auto',
  Light = 'light',
  Dark = 'dark',
}

export const colorThemeOptions = [
  { label: 'Red', rgb: { light: '229,57,53', dark: '239,83,80' } },
  { label: 'Pink', rgb: { light: '233,30,99', dark: '240,98,146' } },
  { label: 'Purple', rgb: { light: '156,39,176', dark: '206,147,216' } },
  { label: 'Deep Purple', rgb: { light: '103,58,183', dark: '179,157,219' } },
  { label: 'Indigo', rgb: { light: '63,81,181', dark: '159,168,218' } },
  { label: 'Blue', rgb: { light: '25,118,210', dark: '100,181,246' } },
  { label: 'Light Blue', rgb: { light: '3,169,244', dark: '79,195,247' } },
  { label: 'Cyan', rgb: { light: '0,188,212', dark: '77,208,225' } },
  { label: 'Teal', rgb: { light: '0,150,136', dark: '128,203,196' } },
  { label: 'Green', rgb: { light: '67,160,71', dark: '129,199,132' } },
  { label: 'Light Green', rgb: { light: '124,179,66', dark: '174,213,129' } },
  { label: 'Lime', rgb: { light: '192,202,51', dark: '220,231,117' } },
  { label: 'Yellow', rgb: { light: '255,214,0', dark: '255,235,59' } },
  { label: 'Amber', rgb: { light: '255,171,0', dark: '255,193,7' } },
  { label: 'Orange', rgb: { light: '230,81,0', dark: '255,183,77' } },
  { label: 'Deep Orange', rgb: { light: '191,54,12', dark: '255,138,101' } },
  { label: 'Brown', rgb: { light: '121,85,72', dark: '161,136,127' } },
  { label: 'Grey', rgb: { light: '117,117,117', dark: '189,189,189' } },
  { label: 'Blue Grey', rgb: { light: '96,125,139', dark: '144,164,174' } },
]
let changeElementPlusTheme: ((color?: string) => void) | undefined

export function setGlobalTheme(label: string) {
  settingsStore.value.colorTheme = label
}

function resolveThemeRgb(label: string, isDark: boolean) {
  const option = colorThemeOptions.find(item => item.label === label)
  if (!option)
    return ''
  return isDark ? option.rgb.dark : option.rgb.light
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
    [() => settingsStore.value.colorTheme, isAppDarkMode],
    ([label, isDark]) => {
      // Element Plus dark mode: https://element-plus.org/zh-CN/guide/dark-mode.html
      // vgo-ui dark tokens and context menus follow html.dark, so only this class is toggled.
      // Toggle it before applying the color: an empty theme reads the computed --vgo-primary-rgb.
      document.documentElement.classList.toggle('dark', isDark)
      applyGlobalTheme(resolveThemeRgb(label, isDark))
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
