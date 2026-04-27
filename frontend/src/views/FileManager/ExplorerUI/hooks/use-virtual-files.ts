import type { ComputedRef, Ref } from 'vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toValue, watch } from 'vue'

export interface VirtualItem<T> {
  item: T
  index: number
}

export interface VirtualListState<T> {
  visibleItems: ComputedRef<VirtualItem<T>[]>
  startIndex: ComputedRef<number>
  endIndex: ComputedRef<number>
  offsetTop: ComputedRef<number>
  beforeHeight: ComputedRef<number>
  afterHeight: ComputedRef<number>
  totalHeight: ComputedRef<number>
  itemHeight: Ref<number>
  refresh: () => void
}

export interface VirtualGridState<T> extends VirtualListState<T> {
  columns: Ref<number>
  rowHeight: ComputedRef<number>
  itemWidth: ComputedRef<number>
  gridStyle: ComputedRef<Record<string, string>>
}

interface UseVirtualListOptions<T> {
  items: Ref<T[]> | ComputedRef<T[]>
  containerRef: Ref<HTMLElement | null>
  itemHeight: Ref<number> | number
  overscan?: number
}

interface UseVirtualGridOptions<T> extends UseVirtualListOptions<T> {
  itemWidth: Ref<number> | ComputedRef<number> | number
  gap?: number
  padding?: number
}

export function useVirtualList<T>({
  items,
  containerRef,
  itemHeight: defaultItemHeight,
  overscan = 8,
}: UseVirtualListOptions<T>): VirtualListState<T> {
  const scrollTop = ref(0)
  const viewportHeight = ref(0)
  const itemHeight = ref(toValue(defaultItemHeight))

  function refresh() {
    const el = containerRef.value
    if (!el) {
      return
    }

    scrollTop.value = el.scrollTop
    viewportHeight.value = el.clientHeight
  }

  const totalHeight = computed(() => items.value.length * itemHeight.value)
  const startIndex = computed(() => {
    return clamp(
      Math.floor(scrollTop.value / itemHeight.value) - overscan,
      0,
      items.value.length,
    )
  })
  const endIndex = computed(() => {
    return clamp(
      Math.ceil((scrollTop.value + viewportHeight.value) / itemHeight.value) + overscan,
      startIndex.value,
      items.value.length,
    )
  })
  const visibleItems = computed(() => {
    return items.value.slice(startIndex.value, endIndex.value).map((item, offset) => ({
      item,
      index: startIndex.value + offset,
    }))
  })
  const beforeHeight = computed(() => startIndex.value * itemHeight.value)
  const afterHeight = computed(() => {
    return Math.max(totalHeight.value - beforeHeight.value - visibleItems.value.length * itemHeight.value, 0)
  })
  const offsetTop = beforeHeight

  setupVirtualMeasurement(containerRef, refresh)
  watch(items, () => nextTick(refresh), { flush: 'post' })
  watch(
    () => toValue(defaultItemHeight),
    (value) => {
      itemHeight.value = value
      nextTick(refresh)
    },
  )

  return {
    visibleItems,
    startIndex,
    endIndex,
    offsetTop,
    beforeHeight,
    afterHeight,
    totalHeight,
    itemHeight,
    refresh,
  }
}

export function useVirtualGrid<T>({
  items,
  containerRef,
  itemHeight: defaultItemHeight,
  itemWidth: defaultItemWidth,
  gap = 4,
  padding = 10,
  overscan = 3,
}: UseVirtualGridOptions<T>): VirtualGridState<T> {
  const scrollTop = ref(0)
  const viewportHeight = ref(0)
  const columns = ref(1)
  const itemHeight = ref(toValue(defaultItemHeight))
  const itemWidth = computed(() => toValue(defaultItemWidth))
  const rowHeight = computed(() => itemHeight.value + gap)

  function refresh() {
    const el = containerRef.value
    if (!el) {
      return
    }

    scrollTop.value = el.scrollTop
    viewportHeight.value = el.clientHeight
    columns.value = Math.max(
      Math.floor((el.clientWidth - padding * 2 + gap) / (itemWidth.value + gap)),
      1,
    )
  }

  const totalRows = computed(() => Math.ceil(items.value.length / columns.value))
  const totalHeight = computed(() => padding * 2 + Math.max(totalRows.value * rowHeight.value - gap, 0))
  const startRow = computed(() => {
    return clamp(Math.floor(Math.max(scrollTop.value - padding, 0) / rowHeight.value) - overscan, 0, totalRows.value)
  })
  const endRow = computed(() => {
    return clamp(
      Math.ceil(Math.max(scrollTop.value + viewportHeight.value - padding, 0) / rowHeight.value) + overscan,
      startRow.value,
      totalRows.value,
    )
  })
  const startIndex = computed(() => startRow.value * columns.value)
  const endIndex = computed(() => Math.min(endRow.value * columns.value, items.value.length))
  const visibleItems = computed(() => {
    return items.value.slice(startIndex.value, endIndex.value).map((item, offset) => ({
      item,
      index: startIndex.value + offset,
    }))
  })
  const beforeHeight = computed(() => padding + startRow.value * rowHeight.value)
  const afterHeight = computed(() => {
    return Math.max(totalHeight.value - beforeHeight.value - Math.ceil(visibleItems.value.length / columns.value) * rowHeight.value, 0)
  })
  const offsetTop = beforeHeight
  const gridStyle = computed(() => ({
    gridTemplateColumns: `repeat(${columns.value}, ${itemWidth.value}px)`,
    gap: `${gap}px`,
  }))

  setupVirtualMeasurement(containerRef, refresh)
  watch(items, () => nextTick(refresh), { flush: 'post' })
  watch(
    () => [toValue(defaultItemHeight), itemWidth.value],
    ([height]) => {
      itemHeight.value = height
      nextTick(refresh)
    },
  )

  return {
    visibleItems,
    startIndex,
    endIndex,
    offsetTop,
    beforeHeight,
    afterHeight,
    totalHeight,
    itemHeight,
    columns,
    rowHeight,
    itemWidth,
    gridStyle,
    refresh,
  }
}

function setupVirtualMeasurement(containerRef: Ref<HTMLElement | null>, refresh: () => void) {
  let resizeObserver: ResizeObserver | undefined

  onMounted(() => {
    nextTick(refresh)

    const el = containerRef.value
    if (!el) {
      return
    }

    el.addEventListener('scroll', refresh, { passive: true })
    resizeObserver = new ResizeObserver(refresh)
    resizeObserver.observe(el)
  })

  onBeforeUnmount(() => {
    const el = containerRef.value
    if (el) {
      el.removeEventListener('scroll', refresh)
    }
    resizeObserver?.disconnect()
  })
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
