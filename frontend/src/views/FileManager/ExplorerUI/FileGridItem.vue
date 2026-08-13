<script setup lang="ts">
import type { IEntry } from '@/types/server'
import ThemedIcon from '@/views/FileManager/ExplorerUI/ThemedIcon.vue'
import { useFileItem } from './hooks/use-file-item'

const props = withDefaults(defineProps<{
  item: IEntry
  basePath: string
  active: boolean
  isCut?: boolean
  showCheckbox?: boolean
  iconSize?: number
}
>(), {
  isCut: false,
  iconSize: 48,
})

defineEmits(['open', 'select'])
const { iconClass, titleDesc, nameDisplay } = useFileItem(props)
</script>

<template>
  <button
    class="vgo-u-button-reset vgo-list-item file-grid-item"
    :class="{ 'is-active': active, 'hidden': item.hidden, 'is-cut': isCut }"
    :title="titleDesc" :style="{ width: `${iconSize + 42}px`, height: `${iconSize + 62}px` }"
    @click.stop="$emit('select', { item, event: $event })"
    @dblclick.stop="$emit('open', { item })"
  >
    <span
      v-if="showCheckbox"
      class="file-checkbox mdi" :class="[
        active ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline',
      ]"
      @click.stop="$emit('select', { item, event: $event, toggle: true })" @dblclick.stop
    />

    <ThemedIcon class="desktop-icon-image" :icon-class="iconClass" :item="item" :abs-path="`${basePath}/${item.name}`" :icon-size="iconSize" />
    <span
      class="desktop-icon-name"
      :class="{
        error: item.error,
      }"
      @click.stop="$emit('open', { item })" @dblclick.stop
    >{{
      nameDisplay
    }}</span>
  </button>
</template>

<style lang="scss" scoped>
.file-grid-item {
  height: 110px;
  width: 90px;
  flex-direction: column;
  justify-content: center;
  min-height: 0;
  padding: var(--vgo-space-2) 2px;
  box-sizing: border-box;
  position: relative;
  border-radius: var(--vgo-radius);

  &:active,
  &:focus {
    outline: 1px dashed currentColor;
    outline-offset: -1px;
  }

  &:hover .file-checkbox,
  &.is-active .file-checkbox {
    visibility: visible;
  }

  &.hidden {
    .desktop-icon-image,
    .desktop-icon-name {
      opacity: 0.6;
    }
  }

  &.is-cut {
    .desktop-icon-image {
      opacity: 0.45;
    }
  }

  .file-checkbox {
    position: absolute;
    top: var(--vgo-space-1);
    left: var(--vgo-space-1);
    visibility: hidden;
    cursor: pointer;
    @media screen and (max-width: $mq_mobile_width) {
      visibility: visible;
    }
  }

  .desktop-icon-image {
    flex-shrink: 0;
    pointer-events: none;

    ::v-deep(.themed-icon-class) {
      font-size: 48px;
    }
  }

  .desktop-icon-name {
    text-align: center;
    font-size: var(--vgo-font-sm);
    line-height: 1.4;
    width: 100%;
    word-break: break-word;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    cursor: pointer;
    &:hover {
      text-decoration: underline;
    }
    &.error {
      color: var(--vgo-danger);
    }
  }
}
</style>
