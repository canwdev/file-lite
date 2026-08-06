<script lang="ts" setup>
import type { FileFilterState } from './file-filter'
import { useDebounceFn } from '@vueuse/core'
import { createDefaultFileFilter } from './file-filter'

const props = defineProps<{
  modelValue: FileFilterState
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: FileFilterState): void
  (e: 'clear'): void
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const localFilter = reactive<FileFilterState>({ ...createDefaultFileFilter() })

const hasText = computed(() => !!localFilter.text.trim())
const isInvalidRegex = computed(() => {
  if (!localFilter.regex || !hasText.value)
    return false
  try {
    // Validate only; matching happens in FileList.
    // eslint-disable-next-line no-new
    new RegExp(localFilter.text)
    return false
  }
  catch {
    return true
  }
})

function syncLocal(value: FileFilterState): void {
  localFilter.text = value.text
  localFilter.regex = value.regex
  localFilter.caseSensitive = value.caseSensitive
}

const emitFilterDebounced = useDebounceFn(() => {
  emit('update:modelValue', { ...localFilter })
}, 300)

function emitFilterNow(): void {
  emit('update:modelValue', { ...localFilter })
}

function clearFilter(): void {
  localFilter.text = ''
  emitFilterNow()
  emit('clear')
}

watch(
  () => props.modelValue,
  value => syncLocal(value),
  { immediate: true, deep: true },
)

watch(
  localFilter,
  () => {
    emitFilterDebounced()
  },
  { deep: true },
)

defineExpose({
  focus() {
    inputRef.value?.focus()
  },
})
</script>

<template>
  <div class="filter-bar" :class="{ 'is-invalid': isInvalidRegex }">
    <span class="mdi mdi-filter-outline filter-icon" />
    <input
      ref="inputRef"
      v-model="localFilter.text"
      placeholder="Filter name"
      class="input-filter vgo-input"
      title="Filter bar (alt+f)"
      @keyup.esc="clearFilter"
    >
    <div class="filter-actions">
      <button
        v-if="hasText"
        class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
        title="Clear filter"
        @click="clearFilter"
      >
        <span class="mdi mdi-close" />
      </button>
      <button
        class="vgo-button vgo-button--text vgo-button--sm filter-toggle"
        :class="{ 'is-active': localFilter.regex }"
        title="Use regular expression"
        @click="localFilter.regex = !localFilter.regex"
      >
        .*
      </button>
      <button
        class="vgo-button vgo-button--text vgo-button--sm filter-toggle"
        :class="{ 'is-active': localFilter.caseSensitive }"
        title="Case sensitive"
        @click="localFilter.caseSensitive = !localFilter.caseSensitive"
      >
        Aa
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.filter-bar {
  position: relative;
  flex: none;
  width: 200px;
  height: var(--vgo-control-md);
  min-width: 0;
  border-radius: var(--vgo-radius);
  outline: 1px solid transparent;

  @media screen and (max-width: $mq_mobile_width) {
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
  }

  &.is-invalid {
    outline-color: var(--vgo-danger);
  }
}

.filter-icon {
  position: absolute;
  left: var(--vgo-space-2);
  top: 50%;
  transform: translateY(-50%);
  color: var(--vgo-text-secondary);
  line-height: 1;
  pointer-events: none;
}

.input-filter {
  width: 100%;
  min-width: 0;
  height: 100%;
  line-height: 1;
  padding: 0 82px 0 28px;
  background: transparent;
}

// 选中态由 .vgo-button.is-active 提供，这里只管字形尺寸
.filter-toggle {
  // ".*" / "Aa" read as glyphs, so keep them at icon-ish size and width inside the sm control
  min-width: var(--vgo-control-md);
  font-size: var(--vgo-font-md);
}

.filter-actions {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  right: var(--vgo-space-1);
  display: flex;
  align-items: center;
}
</style>
