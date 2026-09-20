<script setup lang="ts">
defineProps<{
  label: string
  collapsed: boolean
}>()

defineEmits<{
  toggle: []
  select: []
}>()
</script>

<template>
  <div
    class="file-group-header"
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
      :aria-label="collapsed ? 'Expand group' : 'Collapse group'"
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
  background-color: var(--vgo-surface);

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
