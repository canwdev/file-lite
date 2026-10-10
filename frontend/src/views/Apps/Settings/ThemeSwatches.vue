<script setup lang="ts">
import { colorThemeOptions, setGlobalTheme, ThemeMode } from '@/hooks/use-global-theme'
import { settingsStore } from '@/store'

const systemDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)

const isDark = computed(() => {
  const mode = settingsStore.value.themeMode
  if (mode === ThemeMode.Dark)
    return true
  if (mode === ThemeMode.Light)
    return false
  return systemDark.value
})

const current = computed(() => settingsStore.value.colorTheme || $t('file_lite_i18n.default'))

function rgbOf(item: (typeof colorThemeOptions)[number]) {
  return isDark.value ? item.rgb.dark : item.rgb.light
}

let media: MediaQueryList | undefined

function onSystemTheme(event: MediaQueryListEvent) {
  systemDark.value = event.matches
}

onMounted(() => {
  media = window.matchMedia('(prefers-color-scheme: dark)')
  systemDark.value = media.matches
  media.addEventListener('change', onSystemTheme)
})

onBeforeUnmount(() => {
  media?.removeEventListener('change', onSystemTheme)
})
</script>

<template>
  <div class="theme-colors">
    <div class="theme-colors__head">
      <span>{{ $t('file_lite_i18n.color') }}</span>
      <span class="theme-colors__current">{{ current }}</span>
    </div>
    <div class="theme-colors__grid">
      <button
        v-for="item in colorThemeOptions"
        :key="item.label"
        type="button"
        class="theme-swatch vgo-u-button-reset"
        :class="{ 'is-active': item.label === settingsStore.colorTheme }"
        :style="{ backgroundColor: `rgb(${rgbOf(item)})` }"
        :title="item.label"
        :aria-label="item.label"
        :aria-pressed="item.label === settingsStore.colorTheme"
        @click="setGlobalTheme(item.label)"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.theme-colors {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--vgo-space-2);
  width: 100%;
  min-width: 0;
}

.theme-colors__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--vgo-space-2);
}

.theme-colors__current {
  font-size: var(--vgo-font-sm);
  color: var(--vgo-text-secondary);
}

.theme-colors__grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--vgo-space-3) var(--vgo-space-2);
}

.theme-swatch {
  width: var(--vgo-control-sm);
  height: var(--vgo-control-sm);
  border-radius: 50%;
  outline: 2px solid transparent;
  outline-offset: 2px;

  &.is-active,
  &:hover {
    outline-color: var(--vgo-text);
  }
}
</style>
