<script setup lang="ts">
import type { ITransferItem } from './types'
import { computed, nextTick, ref, watch } from 'vue'
import { useVirtualList } from '../ExplorerUI/hooks/use-virtual-files'
import TransferRow from './TransferRow.vue'

// 上传 / 下载列表。虚拟滚动只在这里，行组件保持纯展示。
const props = defineProps<{ items: ITransferItem[] }>()
defineEmits<{
  cancel: [item: ITransferItem]
  retry: [item: ITransferItem]
  manualDownload: [item: ITransferItem]
}>()

const listRef = ref<HTMLElement | null>(null)
const itemHeight = ref(54)
const { visibleItems, beforeHeight, afterHeight } = useVirtualList({
  items: computed(() => props.items),
  containerRef: listRef,
  itemHeight,
  overscan: 8,
})

watch(() => visibleItems.value.length, () => nextTick(measureItemHeight), { immediate: true })

// 行高由内容决定（名字可能换行），量一次再喂给虚拟列表，否则滚动位置会漂
function measureItemHeight() {
  const el = listRef.value?.querySelector<HTMLElement>('.transfer-item')
  if (!el) {
    return
  }
  const measured = el.offsetHeight
  if (measured > 0 && Math.abs(measured - itemHeight.value) > 1) {
    itemHeight.value = measured
  }
}
</script>

<template>
  <div ref="listRef" class="transfer-list vgo-u-scrollbar">
    <div v-if="!items.length" class="vgo-empty transfer-list__empty">
      <MdiIcon class="vgo-empty__icon" name="cloud-outline" />
      <div class="vgo-empty__title">
        No transfers
      </div>
      <div class="vgo-empty__desc">
        Uploads and downloads show up here.
      </div>
    </div>
    <template v-else>
      <div
        v-if="beforeHeight"
        class="transfer-virtual-spacer"
        :style="{ height: `${beforeHeight}px` }"
      />
      <TransferRow
        v-for="{ item } in visibleItems"
        :key="item.index"
        :item="item"
        @cancel="$emit('cancel', $event)"
        @retry="$emit('retry', $event)"
        @manual-download="$emit('manualDownload', $event)"
      />
      <div
        v-if="afterHeight"
        class="transfer-virtual-spacer"
        :style="{ height: `${afterHeight}px` }"
      />
    </template>
  </div>
</template>

<style scoped lang="scss">
.transfer-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;

  .transfer-virtual-spacer {
    pointer-events: none;
  }

  &__empty {
    height: 100%;
  }
}
</style>
