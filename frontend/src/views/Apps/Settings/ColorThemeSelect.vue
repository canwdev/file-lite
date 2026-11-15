<script setup lang="ts">
import { ElOption, ElSelect } from 'element-plus'
import { colorThemeOptions, useAppDarkMode } from '@/hooks/use-global-theme'
import { settingsStore } from '@/store'
import 'element-plus/es/components/option/style/css'
import 'element-plus/es/components/select/style/css'

/**
 * Colour theme picker: a dropdown whose entries show the colour they apply.
 *
 * Element Plus' option slot is the only way to put a swatch inside the list, so
 * this replaces the `SELECT` option type — which renders bare labels only — while
 * keeping the row a normal Settings row (`actionRender`).
 */
const isDark = useAppDarkMode()

/** Empty means the built-in accent, listed as Default. */
const current = computed({
  get: () => settingsStore.value.colorTheme,
  set: (value: string) => {
    settingsStore.value.colorTheme = value
  },
})

function rgbOf(item: (typeof colorThemeOptions)[number]) {
  return isDark.value ? item.rgb.dark : item.rgb.light
}

/** The swatch shown in the closed select; none for Default, which has no colour. */
const currentSwatch = computed(() => {
  const item = colorThemeOptions.find(option => option.label === current.value)
  return item ? rgbOf(item) : ''
})
</script>

<template>
  <ElSelect
    v-model="current"
    class="vgo-option-action__control"
    :placeholder="$t('file_lite_i18n.default')"
    :teleported="false"
  >
    <template v-if="currentSwatch" #prefix>
      <span class="color-theme-option__swatch" :style="{ backgroundColor: `rgb(${currentSwatch})` }" />
    </template>
    <ElOption :label="$t('file_lite_i18n.default')" value="" />
    <ElOption
      v-for="item in colorThemeOptions"
      :key="item.label"
      :label="item.label"
      :value="item.label"
    >
      <span class="color-theme-option">
        <span class="color-theme-option__swatch" :style="{ backgroundColor: `rgb(${rgbOf(item)})` }" />
        {{ item.label }}
      </span>
    </ElOption>
  </ElSelect>
</template>

<style scoped lang="scss">
.color-theme-option {
  display: inline-flex;
  gap: var(--vgo-space-2);
  align-items: center;
}

.color-theme-option__swatch {
  flex-shrink: 0;
  width: var(--vgo-icon-sm);
  height: var(--vgo-icon-sm);
  border-radius: var(--vgo-radius);
}
</style>
