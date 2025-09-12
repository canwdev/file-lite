<script setup lang="ts">
import {bytesToSize, formatDate} from '@/utils'
import {IEntry} from '@server/types/server'
import {useFileItem} from './hooks/use-file-item'
import ThemedIcon from '@/views/FileManager/ExplorerUI/ThemedIcon.vue'

const emit = defineEmits(['open', 'select'])

interface Props {
  item: IEntry
  active: boolean
  showCheckbox?: boolean
}
const props = withDefaults(defineProps<Props>(), {})

const {iconClass, titleDesc, extDisplay, nameDisplay} = useFileItem(props)
</script>

<template>
  <button
    class="btn-no-style file-list-item file-list-row"
    :class="{active, hidden: item.hidden}"
    @click.stop="$emit('select', {item, event: $event})"
    @keyup.enter="$emit('open', item)"
    @dblclick.stop="$emit('open', item)"
    :title="titleDesc"
  >
    <div class="list-col c-checkbox">
      <input
        v-if="showCheckbox"
        class="file-checkbox"
        type="checkbox"
        :checked="active"
        @click.stop="$emit('select', {item, event: $event, toggle: true})"
        @dblclick.stop
      />
    </div>
    <span class="list-col c-filename">
      <ThemedIcon :icon-class="iconClass" />
      <span class="text-overflow filename-text" @click.stop="$emit('open', item)" @dblclick.stop>
        {{ nameDisplay }}
      </span>
    </span>
    <span class="list-col c-ext text-overflow">{{ extDisplay }}</span>
    <span class="list-col c-size">{{ item.size === null ? '-' : bytesToSize(item.size) }}</span>
    <span class="list-col c-time">{{ formatDate(item.lastModified) }}</span>
    <span class="list-col c-time">{{ formatDate(item.birthtime) }}</span>
  </button>
</template>

<style lang="scss" scoped>
.file-list-item {
  display: flex;
  text-align: unset;
  width: 100%;
  padding-top: 4px;
  padding-bottom: 4px;
  cursor: default;

  @media screen and (max-width: $mq_mobile_width) {
    padding-top: 8px;
    padding-bottom: 8px;
  }

  &:nth-child(2n) {
    background-color: rgba(234, 234, 234, 0.47);
  }

  &:hover {
    transition: background-color 0s;
    background-color: var(--vgo-primary-opacity);
    .file-checkbox {
      visibility: visible;
    }
  }
  &.hidden {
    .filename-text {
      opacity: 0.6;
    }
  }

  &.active {
    background-color: var(--vgo-primary-opacity);
    outline: 1px solid var(--vgo-primary);
    outline-offset: -1px;
    .file-checkbox {
      visibility: visible;
    }
  }
  &:focus {
    outline: 1px solid var(--vgo-primary);
    outline-offset: -1px;
  }

  .file-checkbox {
    visibility: hidden;
    position: relative;
  }

  .list-col {
    display: flex;
    line-height: 1;
    &.c-filename {
      .themed-icon {
        width: 18px;
        height: 18px;
      }
      .filename-text {
        font-size: 12px;
        line-height: 1.2;
        cursor: pointer;

        &:hover {
          text-decoration: underline;
        }
      }
    }

    &.c-ext {
      font-size: 12px;
    }

    &.c-size {
      font-size: 12px;
    }

    &.c-time {
      font-size: 12px;
    }
  }
}
</style>
