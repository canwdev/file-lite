<script setup lang="ts">
defineProps<{
  label: string
  collapsed: boolean
  /**
   * When provided, the header becomes a zero-footprint sticky bar pinned at
   * `stickyTop` inside the nearest scroll container. Place it in the scroll
   * content flow (not inside a table row): it sticks vertically and scrolls
   * horizontally with the content.
   */
  stickyTop?: number
}>()

defineEmits<{
  toggle: []
  select: []
}>()
</script>

<template>
  <div
    class="file-group-header"
    :class="{ 'is-sticky': stickyTop !== undefined }"
    :style="stickyTop !== undefined ? { top: `${stickyTop}px` } : undefined"
    role="button"
    tabindex="0"
    @click.stop="$emit('select')"
    @mousedown.stop
    @keydown.enter.prevent="$emit('select')"
  >
    <button
      type="button"
      class="vgo-u-button-reset file-group-header__toggle"
      :aria-expanded="!collapsed"
      :aria-label="collapsed ? $t('file_lite_i18n.expand_group') : $t('file_lite_i18n.collapse_group')"
      @click.stop="$emit('toggle')"
    >
      <i-mdi-chevron-right v-if="collapsed" class="vgo-u-icon-sm" />
      <i-mdi-chevron-down v-else class="vgo-u-icon-sm" />
    </button>
    <span class="file-group-header__label">{{ label }}</span>
  </div>
</template>

<style lang="scss" scoped>
.file-group-header {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--vgo-space-1);
  width: 100%;
  height: var(--vgo-control-md);
  padding: 0 var(--vgo-space-2);
  font-size: var(--vgo-font-md);
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  color: var(--vgo-text);

  > * {
    position: relative;
    z-index: 1;
  }

  &:hover::before {
    content: '';
    position: absolute;
    inset: 0;
    background-color: var(--vgo-hover);
  }

  &.is-sticky {
    position: sticky;
    z-index: calc(var(--vgo-z-sticky) - 1);
    background-color: var(--vgo-surface);
    // Keep the flow footprint at zero so the bar overlays content instead of
    // pushing it down; the header stays full height for the visible bar.
    margin-bottom: calc(-1 * var(--vgo-control-md));
  }
}

.file-group-header__toggle {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: inherit;
  cursor: pointer;
}

.file-group-header__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
