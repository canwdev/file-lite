<script setup lang="ts">
import type { IEntry } from '@/types/server'
import ThemedIcon from '@/views/FileManager/ExplorerUI/ThemedIcon.vue'
import { useFileItem } from './hooks/use-file-item'

const props = withDefaults(defineProps<{
  item: IEntry
  basePath: string
  active: boolean
  showCheckbox?: boolean
  iconSize?: number
}
>(), {
  iconSize: 48,
})

defineEmits(['open', 'select'])
const { iconClass, titleDesc, nameDisplay } = useFileItem(props)
</script>

<template>
  <button
    class="file-grid-item btn-no-style" :class="{ active, hidden: item.hidden }"
    :title="titleDesc" :style="{ width: `${iconSize + 42}px` }"
    @click.stop="$emit('select', { item, event: $event })" @keyup.enter="$emit('open', { item })"
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
  height: fit-content;
  display: inline-flex;
  align-items: center;
  flex-direction: column;
  cursor: default;
  width: 90px;
  padding: 8px 2px;
  box-sizing: border-box;
  position: relative;
  border-radius: 4px;

  &:active,
  &:focus {
    outline: 1px dashed currentColor;
    outline-offset: -1px;
  }

  &:hover {
    background-color: rgba(224, 224, 224, 0.3);

    .file-checkbox {
      visibility: visible;
    }
  }

  &.hidden {
    .desktop-icon-image,
    .desktop-icon-name {
      opacity: 0.6;
    }
  }

  &.active {
    background-color: var(--vgo-primary-opacity);
    outline: 1px solid var(--vgo-primary);

    .file-checkbox {
      visibility: visible;
    }
  }

  .file-checkbox {
    position: absolute;
    top: 4px;
    left: 4px;
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
    font-size: 12px;
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
      color: #f44336;
    }
  }
}
</style>
